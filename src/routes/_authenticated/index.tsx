import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { listSystemCatalog, getMe } from "@/lib/admin.functions";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  Sparkles,
  AlertTriangle,
  Check,
  X,
  Trash2,
  Loader2,
  ListChecks,
  FileText,
  Image as ImageIcon,
  ArrowRightLeft,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { parseFile } from "@/lib/file-parser";
import { BatteryProgress } from "@/components/BatteryProgress";
import { ThemeToggle } from "@/components/ThemeToggle";
import { MondayAuthButton, useMondayUser } from "@/components/MondayAuth";

// ייבוא פונקציות השרת מהקובץ המבודד החדש
import { generateScenariosServer, analyzeChangesServer, getAppDataServer } from "@/lib/server-functions";

const SYSTEMS = ['נמ"ר', "מזור", 'אל"ה', "רקמה", "CoView", "FHIR"] as const;
const MODULES_BY_SYSTEM: Record<string, string[]> = {
  'נמ"ר': ["אדמיניסטרציה", "התחשבנות", "ממשקים"],
  מזור: [],
  'אל"ה': [],
  רקמה: [],
  CoView: [],
  FHIR: [],
};

export const Route = createFileRoute("/_authenticated/")({
  component: HomePage,
});

interface Spec {
  id: string;
  name: string;
  file_type: string;
  created_at: string;
  system: string | null;
  module: string | null;
  tester: string | null;
  implementer: string | null;
}

interface Scenario {
  id: string;
  spec_id: string | null;
  title: string;
  area: string | null;
  preconditions: string | null;
  steps: string[];
  expected_result: string | null;
  priority: string;
  type: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ChangeRecord {
  id: string;
  scenario_id: string | null;
  new_spec_id: string | null;
  reason: string;
  proposed: any;
  status: string;
  created_at: string;
}

function Stat({ n, label, highlight = false }: { n: number; label: string; highlight?: boolean }) {
  return (
    <div className={`flex flex-col items-center rounded-xl px-4 py-2 text-center backdrop-blur transition-all ${
      highlight ? "bg-destructive/20 ring-1 ring-destructive/30" : "bg-white/10"
    }`}>
      <span className="text-xl font-bold">{n}</span>
      <span className="text-xs text-primary-foreground/70">{label}</span>
    </div>
  );
}

function HomePage() {
  const { user: mondayUser } = useMondayUser();
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [changes, setChanges] = useState<ChangeRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const [progress, setProgress] = useState(0);
  const [progressVisible, setProgressVisible] = useState(false);

  const pendingChangesCount = changes.filter((c) => c.status === "pending").length;

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let finishInterval: ReturnType<typeof setInterval> | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    if (busy) {
      setProgressVisible(true);
      setProgress(4);
      interval = setInterval(() => {
        setProgress((p) => {
          if (p >= 92) return p;
          const remaining = 92 - p;
          const step = Math.max(0.4, remaining * 0.06);
          return Math.min(92, p + step);
        });
      }, 350);
    } else if (progressVisible) {
      finishInterval = setInterval(() => {
        setProgress((p) => {
          if (p >= 100) {
            if (finishInterval) clearInterval(finishInterval);
            return 100;
          }
          const remaining = 100 - p;
          const step = Math.max(0.6, remaining * 0.18);
          return Math.min(100, p + step);
        });
      }, 40);
      hideTimer = setTimeout(() => {
        setProgressVisible(false);
        setProgress(0);
      }, 1200);
    }
    return () => {
      if (interval) clearInterval(interval);
      if (finishInterval) clearInterval(finishInterval);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [busy, progressVisible]);

  const [tab, setTab] = useState("upload");
  const fileRef = useRef<HTMLInputElement>(null);
  const includeImagesRef = useRef<boolean>(true);
  const mondayItemMapRef = useRef<Map<string, string>>(new Map());
  const [images] = useState<{ name: string; dataUrl: string }[]>([]);
  const [meta, setMeta] = useState<{
    system: string;
    module: string;
    tester: string;
    implementer: string;
  }>({
    system: "",
    module: "",
    tester: "גד",
    implementer: "גד",
  });
  const [drag, setDrag] = useState(false);
  const [specSearch, setSpecSearch] = useState("");

  const { data: catalogSystems = [] } = useQuery({
    queryKey: ["system_catalog"],
    queryFn: () => listSystemCatalog(),
  });
  const { data: me } = useQuery({ 
    queryKey: ["me"], 
    queryFn: () => getMe() 
  });
  
  const allSystems = Array.from(
    new Set<string>([...SYSTEMS, ...catalogSystems.map((c: any) => c.name)]),
  );

  useEffect(() => {
    if (!me || me.is_admin) return;
    const assigned = (me.systems ?? []).map((s: any) => s.name);
    if (assigned.length === 1) {
      setMeta((m) => ({ ...m, system: assigned[0], module: "" }));
    } else if (assigned.length === 0) {
      setMeta((m) => ({ ...m, system: "", module: "" }));
    }
  }, [me]);

  const loadAll = useCallback(async () => {
    try {
      const data = await getAppDataServer();
      setSpecs(data.specs as Spec[]);
      setScenarios(
        (data.scenarios as any[]).map((r) => ({
          ...r,
          steps: Array.isArray(r.steps) ? r.steps : [],
        })),
      );
      setChanges(data.changes as ChangeRecord[]);
    } catch (e) {
      console.error("Error loading data via fetch proxy:", e);
      const { data: s } = await supabase.from("specs").select("*");
      const { data: sc } = await supabase.from("scenarios").select("*");
      const { data: ch } = await supabase.from("scenario_changes").select("*");
      if (s) setSpecs(s as Spec[]);
      if (sc) setScenarios((sc as any[]).map(r => ({ ...r, steps: Array.isArray(r.steps) ? r.steps : [] })));
      if (ch) setChanges(ch as ChangeRecord[]);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const validateMeta = () => {
    if (!meta.system) {
      toast.error("יש לבחור מערכת");
      return false;
    }
    const moduleOpts = MODULES_BY_SYSTEM[meta.system] ?? [];
    if (moduleOpts.length > 0 && !meta.module) {
      toast.error("יש לבחור מודול");
      return false;
    }
    if (!meta.tester.trim()) {
      toast.error("יש למלא בודק אחראי");
      return false;
    }
    if (!meta.implementer.trim()) {
      toast.error("יש למלא מיישם אחראי");
      return false;
    }
    return true;
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!validateMeta()) return;

    const attachedImages = includeImagesRef.current ? images.map((i) => i.dataUrl) : [];
    setBusy(true);
    try {
      let workingScenarios = [...scenarios];
      let detectedChanges = 0;

      for (const file of Array.from(files)) {
        toast.info(`מעבד את ${file.name}...`);
        
        let content = "";
        let type = file.type || "text/plain";
        
        try {
          const parsed = await parseFile(file);
          content = parsed.content;
          type = parsed.type;
        } catch (parseError) {
          console.warn("ה-parser נכשל, מנסה קריאה ישירה של קובץ טקסט", parseError);
          content = await file.text();
        }

        if (!content.trim()) {
          throw new Error("לא ניתן היה לחלץ טקסט מהקובץ שנבחר.");
        }

        const existingScenarios = [...workingScenarios];
        
        const result = await generateScenariosServer({
          specContent: content,
          specName: file.name,
          system: meta.system,
          images: attachedImages
        });
        
        if (!Array.isArray(result) || result.length === 0) {
          throw new Error("לא נוצרו תסריטים מהאפיון. נסו לטעון אפיון מפורט יותר.");
        }

        const { data: spec, error } = await supabase
          .from("specs")
          .insert({
            name: file.name,
            content,
            file_type: type,
            system: meta.system,
            module: meta.module || null,
            tester: meta.tester.trim(),
            implementer: meta.implementer.trim(),
            monday_item_id: mondayItemMapRef.current.get(file.name) ?? null,
            created_by_monday_user_id: mondayUser?.mondayUserId ?? null,
          })
          .select()
          .single();
          
        if (error || !spec) throw error ?? new Error("שגיאה בשמירה למסד הנתונים");

        const { data: inserted, error: scenarioError } = await supabase
          .from("scenarios")
          .insert(
            result.map((r) => ({
              spec_id: spec.id,
              title: r.title,
              area: r.area ?? null,
              preconditions: r.preconditions ?? null,
              steps: r.steps,
              expected_result: r.expected_result,
              priority: r.priority,
              type: r.type,
            })),
          )
          .select();

        if (scenarioError) {
          await supabase.from("specs").delete().eq("id", spec.id);
          throw scenarioError;
        }

        if (inserted) {
          workingScenarios = [
            ...workingScenarios,
            ...(inserted as any[]).map((r) => ({
              ...r,
              steps: Array.isArray(r.steps) ? r.steps : [],
            })),
          ];
        }

        toast.success(`נוצרו ${result.length} תסריטים מ־${file.name}`);

        if (existingScenarios.length > 0) {
          try {
            const res = await analyzeChangesServer({
              specContent: content,
              specName: file.name,
              existingScenarios: existingScenarios.map((s) => ({
                id: s.id,
                title: s.title,
                area: s.area,
                preconditions: s.preconditions,
                steps: s.steps,
                expected_result: s.expected_result,
                priority: s.priority,
                type: s.type,
              })),
            });
            
            const inserts: any[] = [];
            for (const ch of res.changes ?? []) {
              inserts.push({
                scenario_id: ch.scenario_id,
                new_spec_id: spec.id,
                reason: ch.reason,
                proposed: ch.updated,
                status: "pending",
              });
            }
            if (inserts.length) {
              await supabase.from("scenario_changes").insert(inserts);
              detectedChanges += inserts.length;
            }
          } catch (e) {
            console.error("ניתוח שינויים נכשל", e);
          }
        }
      }

      if (detectedChanges > 0) {
        toast.warning(`זוהו ${detectedChanges} עדכונים מוצעים לתסריטים קיימים`);
        setTab("changes");
      } else {
        setTab("scenarios");
      }
      await loadAll();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "שגיאה בעיבוד הקובץ");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeSpec = async (s: Spec) => {
    if (!confirm(`להסיר את האפיון "${s.name}" וכל התסריטים שנוצרו ממנו?`)) return;
    try {
      await supabase.from("scenario_changes").delete().eq("new_spec_id", s.id);
      await supabase.from("scenarios").delete().eq("spec_id", s.id);
      const { error } = await supabase.from("specs").delete().eq("id", s.id);
      if (error) throw error;
      toast.success(`האפיון "${s.name}" הוסר`);
      await loadAll();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "שגיאה בהסרת האפיון");
    }
  };

  const acceptChange = async (c: ChangeRecord) => {
    try {
      if (c.scenario_id) {
        const p = c.proposed;
        await supabase
          .from("scenarios")
          .update({
            title: p.title,
            area: p.area ?? null,
            preconditions: p.preconditions ?? null,
            steps: p.steps,
            expected_result: p.expected_result,
            priority: p.priority,
            type: p.type,
          })
          .eq("id", c.scenario_id);
      } else {
        const p = c.proposed;
        await supabase.from("scenarios").insert({
          spec_id: c.new_spec_id,
          title: p.title,
          area: p.area ?? null,
          preconditions: p.preconditions ?? null,
          steps: p.steps,
          expected_result: p.expected_result,
          priority: p.priority,
          type: p.type,
        });
      }
      await supabase.from("scenario_changes").update({ status: "approved" }).eq("id", c.id);
      toast.success("השינוי אושר");
      await loadAll();
    } catch (e: any) {
      toast.error(e?.message ?? "שגיאה");
    }
  };

  const rejectChange = async (c: ChangeRecord) => {
    await supabase.from("scenario_changes").update({ status: "rejected" }).eq("id", c.id);
    toast.info("השינוי נדחה");
    await loadAll();
  };

  const deleteScenario = async (id: string) => {
    await supabase.from("scenarios").delete().eq("id", id);
    toast.success("התסריט נמחק");
    await loadAll();
  };

  return (
    <div dir="rtl" className="min-h-screen text-right">
      <ThemeToggle />
      <BatteryProgress visible={progressVisible} progress={progress} />

      <aside className="fixed right-4 top-1/2 z-30 -translate-y-1/2">
        <div className="glass-panel flex flex-col items-stretch gap-1 rounded-2xl p-2 shadow-lg backdrop-blur">
          <button
            type="button"
            onClick={() => setTab("upload")}
            className={`group flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition ${
              tab === "upload" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
          >
            <Upload className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap">טעינת אפיון</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("scenarios")}
            className={`group flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition ${
              tab === "scenarios" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
          >
            <ListChecks className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap">תסריטים ({scenarios.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("changes")}
            className={`group relative flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition ${
              tab === "changes" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap">שינויים ממתינים</span>
            {pendingChangesCount > 0 && (
              <span className="mr-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs text-white">
                {pendingChangesCount}
              </span>
            )}
          </button>
          <div className="my-1 h-px bg-border" />
          <div className="px-1 py-1">
            <MondayAuthButton />
          </div>
        </div>
      </aside>

      <header className="relative overflow-hidden">
        <div className="absolute inset-0 opacity-90" style={{ background: "var(--gradient-hero)" }} />
        <div className="relative mx-auto max-w-6xl px-6 py-8 text-primary-foreground">
          <div className="flex flex-col items-center text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" /> מבוסס AI
            </div>
            <h1 className="mt-3 text-3xl font-bold sm:text-4xl tracking-tight">
              QAI — תסריטי בדיקה חכמים
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-primary-foreground/85">
              טענו אפיון פונקציונלי או טכני, קבלו רשימה מפורטת של תסריטי בדיקה, ייצאו MONDAY ואקסל, ועדכנו
              תסריטים אוטומטית כשהאפיון משתנה.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
              <Stat n={specs.length} label="אפיונים" />
              <Stat n={scenarios.length} label="תסריטים פעילים" />
              <Stat n={pendingChangesCount} label="ממתינים לעדכון" highlight={pendingChangesCount > 0} />
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-6 py-10 pl-6 pr-6 lg:pl-6 lg:pr-44">
        <Tabs value={tab} onValueChange={setTab} dir="rtl">
          <TabsContent value="upload" className="mt-6 space-y-6">
            <Card
              className={`glass-panel relative overflow-hidden rounded-[2rem] p-6 text-right transition-all hover:shadow-[var(--shadow-elegant)] ${
                drag ? "ring-2 ring-primary" : ""
              }`}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
            >
              <div className="absolute left-6 top-6 inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Sparkles className="h-5 w-5" />
              </div>
              <h3 className="text-xl font-bold tracking-tight">טעינת אפיון</h3>
              <p className="mt-2 text-sm leading-7 text-muted-foreground max-w-3xl">
                טענו קובץ אפיון פונקציונלי או טכני (PDF / Word / טקסט) ומלאו את מאפייני האפיון. המערכת תייצר תסריטי בדיקה חדשים, ובמקביל תבדוק האם האפיון משפיע על תסריטים קיימים ותציע עדכונים.
              </p>

              <div dir="rtl" className="mt-8 grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <Label className="font-bold">מערכת</Label>
                  <Select value={meta.system} onValueChange={(v) => setMeta(m => ({ ...m, system: v, module: "" }))}>
                    <SelectTrigger className="bg-background/50 backdrop-blur"><SelectValue placeholder="בחר מערכת" /></SelectTrigger>
                    <SelectContent>
                      {allSystems.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="font-bold">מודול / תת מערכת</Label>
                  <Select value={meta.module} onValueChange={(v) => setMeta(m => ({ ...m, module: v }))}>
                    <SelectTrigger className="bg-background/50 backdrop-blur"><SelectValue placeholder="אדמיניסטרציה" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="אדמיניסטרציה">אדמיניסטרציה</SelectItem>
                      {(MODULES_BY_SYSTEM[meta.system] ?? []).map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="font-bold">בודק אחראי</Label>
                  <Input value={meta.tester} onChange={(e) => setMeta(m => ({ ...m, tester: e.target.value }))} className="bg-background/50 backdrop-blur" />
                </div>

                <div className="space-y-2">
                  <Label className="font-bold">מיישם אחראי</Label>
                  <Input value={meta.implementer} onChange={(e) => setMeta(m => ({ ...m, implementer: e.target.value }))} className="bg-background/50 backdrop-blur" />
                </div>
              </div>

              <div className="mt-8 flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/20 rounded-2xl p-10 transition hover:border-primary/40 bg-muted/5">
                <Upload className="h-10 w-10 text-muted-foreground/40 mb-3" />
                <p className="text-base font-bold mb-1">גרור קובץ לכאן או לחץ לבחירה</p>
                <p className="text-xs text-muted-foreground mb-6">20MB עד PDF, Word, TXT</p>
                <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
                <Button disabled={busy} onClick={() => setShowModal(true)} size="lg" className="shadow-md">
                  {busy ? <Loader2 className="h-5 w-5 animate-spin ml-2" /> : <Upload className="h-5 w-5 ml-2" />}
                  בחר קבצים
                </Button>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="scenarios" className="mt-6">
            <Card className="glass-panel rounded-[2rem] p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <h3 className="text-lg font-semibold">תסריטי בדיקה בדיקות פעילים במערכת</h3>
                <Input value={specSearch} onChange={(e) => setSpecSearch(e.target.value)} placeholder="חיפוש אפיון..." className="max-w-xs" />
              </div>
              {specs.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">אין עדיין תסריטים במערכת.</div>
              ) : (
                <div className="space-y-4">
                  {specs.filter(s => s.name.toLowerCase().includes(specSearch.toLowerCase())).map(s => {
                    const specScenarios = scenarios.filter(sc => sc.spec_id === s.id);
                    return (
                      <Card key={s.id} className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="font-bold text-base">{s.name}</h4>
                            <p className="text-xs text-muted-foreground mt-1">מערכת: {s.system} | בודק: {s.tester}</p>
                          </div>
                          <Button size="sm" variant="destructive" onClick={() => removeSpec(s)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                        {specScenarios.map(sc => (
                          <div key={sc.id} className="flex items-start justify-between p-2 mt-2 rounded bg-muted/30 text-sm">
                            <span>{sc.title}</span>
                            <Button size="sm" variant="ghost" className="text-destructive h-7 w-7 p-0" onClick={() => deleteScenario(sc.id)}><X className="h-4 w-4" /></Button>
                          </div>
                        ))}
                      </Card>
                    );
                  })}
                </div>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="changes" className="mt-6">
            <Card className="glass-panel rounded-[2rem] p-6">
              <h3 className="text-lg font-semibold mb-4">שינויים ועדכונים ממתינים לאישור</h3>
              {pendingChangesCount === 0 ? (
                <div className="text-center py-12 text-muted-foreground">אין כרגע שינויים ממתינים לאישור. המערכת מסונכרנת לחלוטין!</div>
              ) : (
                <div className="space-y-4">
                  {changes.filter(c => c.status === "pending").map(c => (
                    <Card key={c.id} className="p-4 border-amber-200 bg-amber-50/10">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <Badge variant="outline" className="mb-2 text-amber-600 border-amber-300">עדכון מוצע</Badge>
                          <p className="font-medium text-sm mb-1"><span className="font-bold">סיבת השינוי:</span> {c.reason}</p>
                          <p className="text-xs font-semibold text-muted-foreground">כותרת חדשה מוצעת: {c.proposed?.title}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => acceptChange(c)}><Check className="h-4 w-4 ml-1" />אשר</Button>
                          <Button size="sm" variant="outline" className="text-destructive border-destructive/20 hover:bg-destructive/5" onClick={() => rejectChange(c)}><X className="h-4 w-4 ml-1" />דחה</Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-xl rounded-3xl bg-background p-6 shadow-2xl border text-right"
              dir="rtl"
            >
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="absolute left-4 top-4 rounded-full p-1.5 text-muted-foreground hover:bg-muted"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="text-center pb-4">
                <h3 className="text-xl font-bold">מה ברצונך לטעון?</h3>
                <p className="text-sm text-muted-foreground mt-1">בחרו את מקור הקלט ליצירת התסריטים</p>
              </div>

              <div className="mt-4 space-y-3">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); fileRef.current?.click(); }}
                  className="w-full flex items-center justify-between p-4 rounded-2xl border bg-muted/10 hover:bg-muted/40 transition text-right"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-blue-500/10 text-blue-500"><ImageIcon className="h-5 w-5" /></div>
                    <div>
                      <p className="font-bold text-sm">תמונות (אופציונלי)</p>
                      <p className="text-xs text-muted-foreground">צילומי מסך / סקיצות / תרשימים • עד 8 תמונות, 6MB כל אחת</p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="gap-1"><Sparkles className="h-3 w-3" /> צירוף תמונות</Badge>
                </button>

                <button
                  type="button"
                  onClick={() => { setShowModal(false); fileRef.current?.click(); }}
                  className="w-full flex items-center gap-3 p-4 rounded-2xl border bg-muted/10 hover:bg-muted/40 transition text-right"
                >
                  <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-500"><FileText className="h-5 w-5" /></div>
                  <div>
                    <p className="font-bold text-sm">אפיון + תמונות</p>
                    <p className="text-xs text-muted-foreground">ניתוח משולב של מסמך האפיון יחד עם 0 תמונות מצורפות</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => { setShowModal(false); fileRef.current?.click(); }}
                  className="w-full flex items-center gap-3 p-4 rounded-2xl border bg-muted/10 hover:bg-muted/40 transition text-right"
                >
                  <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500"><FileText className="h-5 w-5" /></div>
                  <div>
                    <p className="font-bold text-sm">אפיון בלבד</p>
                    <p className="text-xs text-muted-foreground">יצירת תסריטים על בסיס מסמך האפיון בלבד (תמונות מצורפות יתעלמו)</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => { setShowModal(false); fileRef.current?.click(); }}
                  className="w-full flex items-center gap-3 p-4 rounded-2xl border bg-muted/10 hover:bg-muted/40 transition text-right"
                >
                  <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500"><ImageIcon className="h-5 w-5" /></div>
                  <div>
                    <p className="font-bold text-sm">תמונות בלבד</p>
                    <p className="text-xs text-muted-foreground">יצירת תסריטים על בסיס 0 התמונות המצורפות בלבד</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => { setShowModal(false); toast.info("מתחבר ל-Monday..."); }}
                  className="w-full flex items-center gap-3 p-4 rounded-2xl border bg-muted/10 hover:bg-muted/40 transition text-right border-purple-500/20"
                >
                  <div className="p-2 rounded-xl bg-purple-500/10 text-purple-500"><ArrowRightLeft className="h-5 w-5" /></div>
                  <div>
                    <p className="font-bold text-sm">ייבוא מ-Monday</p>
                    <p className="text-xs text-muted-foreground">שליפת קבצי אפיון מצורפים מבורד מוגדר לפי סטטוס</p>
                  </div>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
