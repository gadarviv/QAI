import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Upload,
  Sparkles,
  AlertTriangle,
  Check,
  X,
  Trash2,
  ListChecks,
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
import { BatteryProgress } from "@/components/BatteryProgress";
import { ThemeToggle } from "@/components/ThemeToggle";

const SYSTEMS = ['נמ"ר', "מזור", 'אל"ה', "רקמה", "CoView", "FHIR"] as const;

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
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [busy] = useState(false);
  const [tab, setTab] = useState("upload");
  const [specSearch, setSpecSearch] = useState("");
  const [meta, setMeta] = useState({
    system: "",
    module: "",
    tester: "",
    implementer: "",
  });

  const loadAll = useCallback(async () => {
    try {
      const { data: specsData } = await supabase.from("specs").select("*");
      const { data: scenariosData } = await supabase.from("scenarios").select("*");
      
      if (specsData) setSpecs(specsData as Spec[]);
      if (scenariosData) {
        setScenarios(
          (scenariosData as any[]).map((r) => ({
            ...r,
            steps: Array.isArray(r.steps) ? r.steps : [],
          })),
        );
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const removeSpec = async (s: Spec) => {
    if (!confirm(`להסיר את האפיון "${s.name}" וכל התסריטים שנוצרו ממנו?`)) return;
    try {
      await supabase.from("scenarios").delete().eq("spec_id", s.id);
      await supabase.from("specs").delete().eq("id", s.id);
      toast.success(`האפיון "${s.name}" הוסר`);
      await loadAll();
    } catch (e: any) {
      toast.error(e?.message ?? "שגיאה בהסרת האפיון");
    }
  };

  const deleteScenario = async (id: string) => {
    await supabase.from("scenarios").delete().eq("id", id);
    toast.success("התסריט נמחק");
    await loadAll();
  };

  return (
    <div dir="rtl" className="min-h-screen text-right">
      <ThemeToggle />
      <BatteryProgress visible={busy} progress={40} />

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
            <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
              <Stat n={specs.length} label="אפיונים" />
              <Stat n={scenarios.length} label="תסריטים פעילים" />
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-6 py-10">
        <Tabs value={tab} onValueChange={setTab} dir="rtl">
          <TabsContent value="upload" className="mt-6 space-y-6">
            <Card className="glass-panel p-6 text-right">
              <h3 className="text-lg font-semibold">טעינת אפיון פשוטה</h3>
              <p className="text-sm text-muted-foreground mt-1">גרסה נקייה לאיתור שגיאות קומפילציה ב-Rollup.</p>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>מערכת</Label>
                  <Select value={meta.system} onValueChange={(v) => setMeta(m => ({ ...m, system: v }))}>
                    <SelectTrigger><SelectValue placeholder="בחר מערכת" /></SelectTrigger>
                    <SelectContent>
                      {SYSTEMS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>בודק אחראי</Label>
                  <Input value={meta.tester} onChange={(e) => setMeta(m => ({ ...m, tester: e.target.value }))} placeholder="שם הבודק" />
                </div>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="scenarios" className="mt-6">
            <Card className="glass-panel p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <h3 className="text-lg font-semibold">תסריטי בדיקה פעילים</h3>
                <Input value={specSearch} onChange={(e) => setSpecSearch(e.target.value)} placeholder="חיפוש..." className="max-w-xs" />
              </div>

              {specs.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">אין עדיין נתונים להצגה.</div>
              ) : (
                <div className="space-y-4">
                  {specs.filter(s => s.name.toLowerCase().includes(specSearch.toLowerCase())).map(s => {
                    const specScenarios = scenarios.filter(sc => sc.spec_id === s.id);
                    return (
                      <Card key={s.id} className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="font-bold text-base">{s.name}</h4>
                            <p className="text-xs text-muted-foreground">מערכת: {s.system} | בודק: {s.tester}</p>
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
        </Tabs>
      </main>
    </div>
  );
}
