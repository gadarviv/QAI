import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listSystemCatalog, getMe } from "@/lib/admin.functions";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  FileText,
  Sparkles,
  Download,
  RefreshCw,
  AlertTriangle,
  Check,
  X,
  Trash2,
  Loader2,
  ListChecks,
  FileSearch,
  ImagePlus,
  ChevronDown,
  Plus,
  Play,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";


import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseFile } from "@/lib/file-parser";
import { exportScenariosToExcel } from "@/lib/excel-export";
import { generateScenarios, analyzeChanges } from "@/lib/scenarios.functions";
import {
  exportScenariosToMonday,
  listMondayFileSpecs,
  downloadMondayAsset,
} from "@/lib/monday.functions";
import { getAppData } from "@/lib/app-data.functions";
import { runFhirRequest } from "@/lib/fhir-test.functions";
import { parseFhirScenario, buildPostmanCollection, isFhirScenario } from "@/lib/fhir-test";
import { BatteryProgress } from "@/components/BatteryProgress";

import { ThemeToggle } from "@/components/ThemeToggle";
import { MondayAuthButton, useMondayUser } from "@/components/MondayAuth";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";

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

const PRIORITY_LABEL: Record<string, string> = {
  low: "נמוכה",
  medium: "בינונית",
  high: "גבוהה",
  critical: "קריטית",
};

const PRIORITY_STYLE: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-accent text-accent-foreground",
  high: "bg-[oklch(0.95_0.1_75)] text-[oklch(0.4_0.15_60)]",
  critical: "bg-[oklch(0.93_0.13_25)] text-[oklch(0.4_0.2_25)]",
};

const TYPE_LABEL: Record<string, string> = {
  functional: "פונקציונלי",
  ui: "ממשק",
  negative: "שלילי",
  integration: "אינטגרציה",
  performance: "ביצועים",
  security: "אבטחה",
};

function HomePage() {
  const { user: mondayUser } = useMondayUser();
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [changes, setChanges] = useState<ChangeRecord[]>([]);
  const [busy, setBusy] = useState(false);

  const [progress, setProgress] = useState(0);
  const [progressVisible, setProgressVisible] = useState(false);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let finishInterval: ReturnType<typeof setInterval> | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    if (busy) {
      setProgressVisible(true);
      setProgress(4);
      // Simulated battery charge: climb slower as it approaches ~92%
      interval = setInterval(() => {
        setProgress((p) => {
          if (p >= 92) return p;
          const remaining = 92 - p;
          const step = Math.max(0.4, remaining * 0.06);
          return Math.min(92, p + step);
        });
      }, 350);
    } else if (progressVisible) {
      // Smoothly ease from current value up to 100 instead of jumping
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);
  const [tab, setTab] = useState("upload");
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const includeImagesRef = useRef<boolean>(true);
  const mondayItemMapRef = useRef<Map<string, string>>(new Map());
  const [images, setImages] = useState<{ name: string; dataUrl: string }[]>([]);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [mondayImportOpen, setMondayImportOpen] = useState(false);
  const [mondayBoardId, setMondayBoardId] = useState("");
  const [mondayStatus, setMondayStatus] = useState("מוכן לבדיקה");
  type MondayMatch = { itemId: string; itemName: string; assets: { id: string; name: string }[] };
  const [mondayPreview, setMondayPreview] = useState<{
    fresh: MondayMatch[];
    skipped: MondayMatch[];
  } | null>(null);
  const [mondaySelected, setMondaySelected] = useState<Set<string>>(new Set());
  const [mondayLoadingPreview, setMondayLoadingPreview] = useState(false);
  const [meta, setMeta] = useState<{
    system: string;
    module: string;
    tester: string;
    implementer: string;
  }>({
    system: "",
    module: "",
    tester: "",
    implementer: "",
  });
  const [drag, setDrag] = useState(false);
  const [appendTarget, setAppendTarget] = useState<Spec | null>(null);
  const [expandedSpecs, setExpandedSpecs] = useState<Set<string>>(new Set());
  const [specSearch, setSpecSearch] = useState("");
  const appendFileRef = useRef<HTMLInputElement>(null);
  const appendImageRef = useRef<HTMLInputElement>(null);

  const genFn = useServerFn(generateScenarios);
  const analyzeFn = useServerFn(analyzeChanges);
  const listSystemCatalogFn = useServerFn(listSystemCatalog);
  const getMeFn = useServerFn(getMe);
  const { data: catalogSystems = [] } = useQuery({
    queryKey: ["system_catalog"],
    queryFn: () => listSystemCatalogFn(),
  });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => getMeFn() });
  const allSystems = Array.from(
    new Set<string>([...SYSTEMS, ...catalogSystems.map((c: any) => c.name)]),
  );
  const dynamicSystems = me?.is_admin
    ? allSystems
    : (me?.systems?.length ?? 0) > 0
      ? allSystems.filter((s) => me!.systems.some((us: any) => us.name === s))
      : [];

  useEffect(() => {
    if (!me || me.is_admin) return;
    const assigned = (me.systems ?? []).map((s: any) => s.name);
    if (assigned.length === 1) {
      setMeta((m) => ({ ...m, system: assigned[0], module: "" }));
    } else if (assigned.length === 0) {
      setMeta((m) => ({ ...m, system: "", module: "" }));
    }
  }, [me]);

  const listMondayFn = useServerFn(listMondayFileSpecs);
  const downloadMondayFn = useServerFn(downloadMondayAsset);

  const handleMondayImport = async () => {
    if (!validateMeta()) return;
    if (!/^\d+$/.test(mondayBoardId.trim())) {
      toast.error("Board ID חייב להיות מספרי");
      return;
    }
    if (!mondayStatus.trim()) {
      toast.error("יש לבחור סטטוס");
      return;
    }
    setMondayLoadingPreview(true);
    try {
      toast.info("שואב פריטים מ-Monday...");
      const { matches } = await listMondayFn({
        data: { boardId: mondayBoardId.trim(), statusLabel: mondayStatus.trim() },
      });
      if (!matches || matches.length === 0) {
        toast.error(`לא נמצאו פריטים עם קבצים בסטטוס "${mondayStatus}"`);
        return;
      }

      const itemIds = matches.map((m) => m.itemId);
      const { data: existingSpecs } = await supabase
        .from("specs")
        .select("monday_item_id")
        .in("monday_item_id", itemIds);
      const alreadyImported = new Set(
        (existingSpecs ?? []).map((s: any) => s.monday_item_id).filter(Boolean),
      );

      const skipped = matches.filter((m) => alreadyImported.has(m.itemId));
      const fresh = matches.filter((m) => !alreadyImported.has(m.itemId));

      setMondayImportOpen(false);
      setMondayPreview({ fresh, skipped });
      setMondaySelected(new Set(fresh.map((m) => m.itemId)));
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "שגיאה בייבוא מ-Monday");
    } finally {
      setMondayLoadingPreview(false);
    }
  };

  const handleMondayConfirm = async () => {
    if (!mondayPreview) return;
    const selectedItems = mondayPreview.fresh.filter((m) => mondaySelected.has(m.itemId));
    if (selectedItems.length === 0) {
      toast.error("בחר לפחות אפיון אחד לייבוא");
      return;
    }
    setMondayPreview(null);
    setBusy(true);
    try {
      mondayItemMapRef.current.clear();
      const files: File[] = [];
      for (const m of selectedItems) {
        for (const a of m.assets) {
          try {
            const dl = await downloadMondayFn({ data: { assetId: a.id } });
            const bin = atob(dl.base64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const fname = `${m.itemName} — ${dl.name}`;
            const file = new File([bytes], fname, { type: dl.mimeType });
            files.push(file);
            mondayItemMapRef.current.set(fname, m.itemId);
          } catch (err: any) {
            console.error(err);
            toast.error(`כשל בהורדת ${a.name}: ${err?.message ?? ""}`);
          }
        }
      }
      if (files.length === 0) {
        toast.error("לא הצלחנו להוריד אף קובץ");
        return;
      }
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      includeImagesRef.current = false;
      toast.success(`הורדו ${files.length} קבצים מ-Monday`);
      await handleFiles(dt.files);
      mondayItemMapRef.current.clear();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "שגיאה בייבוא מ-Monday");
    } finally {
      setBusy(false);
    }
  };

  const getDataFn = useServerFn(getAppData);

  const loadAll = useCallback(async () => {
    const data = await getDataFn();
    setSpecs(data.specs as Spec[]);
    setScenarios(
      (data.scenarios as any[]).map((r) => ({
        ...r,
        steps: Array.isArray(r.steps) ? r.steps : [],
      })),
    );
    setChanges(data.changes as ChangeRecord[]);
  }, [getDataFn]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const fileToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("לא ניתן לקרוא את התמונה"));
      };
      img.src = objectUrl;
    });

  const handleImageFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const added: { name: string; dataUrl: string }[] = [];
    for (const f of Array.from(files)) {
      if (!/^image\/(png|jpe?g|webp)$/i.test(f.type)) {
        toast.error(`התמונה ${f.name} אינה בפורמט נתמך`);
        continue;
      }
      if (f.size > 10 * 1024 * 1024) {
        toast.error(`התמונה ${f.name} גדולה מ-10MB`);
        continue;
      }
      added.push({ name: f.name, dataUrl: await fileToDataUrl(f) });
    }
    setImages((prev) => [...prev, ...added].slice(0, 8));
    if (imageRef.current) imageRef.current.value = "";
  };

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

  const generateFromImagesOnly = async () => {
    if (images.length === 0) return toast.error("יש לצרף תמונה אחת לפחות");
    if (!validateMeta()) return;
    setBusy(true);
    try {
      const specName = `תסריטים מתמונה - ${new Date().toLocaleString("he-IL")}`;
      const imageUrls = images.map((i) => i.dataUrl);
      const result = await genFn({ data: { specContent: "", specName, system: meta.system, images: imageUrls } });
      if (!Array.isArray(result) || result.length === 0)
        throw new Error("לא נוצרו תסריטים מהתמונות");

      const { data: spec, error } = await supabase
        .from("specs")
        .insert({
          name: specName,
          content: `(נוצר מ-${images.length} תמונות)\n` + images.map((i) => i.name).join("\n"),
          file_type: "image",
          system: meta.system,
          module: meta.module || null,
          tester: meta.tester.trim(),
          implementer: meta.implementer.trim(),
          created_by_monday_user_id: mondayUser?.mondayUserId ?? null,

        })
        .select()
        .single();
      if (error || !spec) throw error ?? new Error("שגיאה בשמירה");

      const { error: scenarioError } = await supabase.from("scenarios").insert(
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
      );
      if (scenarioError) {
        await supabase.from("specs").delete().eq("id", spec.id);
        throw scenarioError;
      }
      toast.success(`נוצרו ${result.length} תסריטים מהתמונות`);
      setImages([]);
      setTab("scenarios");
      await loadAll();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "שגיאה בעיבוד התמונות");
    } finally {
      setBusy(false);
    }
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
        const { content, type } = await parseFile(file);
        const existingScenarios = [...workingScenarios];
        const result = await genFn({
          data: { specContent: content, specName: file.name, system: meta.system, images: attachedImages },
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
        if (error || !spec) throw error ?? new Error("שגיאה בשמירה");

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

        // 1. Always check impact on existing scenarios first
        if (existingScenarios.length > 0) {
          try {
            const res = await analyzeFn({
              data: {
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
              },
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
            console.error("analyze failed", e);
          }
        }
      }

      if (detectedChanges > 0) {
        toast.warning(`זוהו ${detectedChanges} עדכונים מוצעים לתסריטים קיימים`);
        setTab("changes");
      } else {
        setTab("scenarios");
      }
      setImages([]);
      await loadAll();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "שגיאה בעיבוד הקובץ");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const appendScenariosToSpec = async (
    target: Spec,
    args: { specContent: string; specName: string; images: string[]; appendedContent?: string },
  ) => {
    setBusy(true);
    try {
      const result = await genFn({
        data: {
          specContent: args.specContent,
          specName: args.specName,
          images: args.images,
        },
      });
      if (!Array.isArray(result) || result.length === 0) {
        throw new Error("לא נוצרו תסריטים נוספים");
      }
      const { error: scenarioError } = await supabase.from("scenarios").insert(
        result.map((r) => ({
          spec_id: target.id,
          title: r.title,
          area: r.area ?? null,
          preconditions: r.preconditions ?? null,
          steps: r.steps,
          expected_result: r.expected_result,
          priority: r.priority,
          type: r.type,
        })),
      );
      if (scenarioError) throw scenarioError;

      if (args.appendedContent) {
        const { data: existing } = await supabase
          .from("specs")
          .select("content")
          .eq("id", target.id)
          .single();
        const merged =
          ((existing as any)?.content ?? "") + `\n\n--- תוספת (${args.specName}) ---\n` + args.appendedContent;
        await supabase.from("specs").update({ content: merged }).eq("id", target.id);
      }

      toast.success(`נוספו ${result.length} תסריטים לאפיון "${target.name}"`);
      setAppendTarget(null);
      setTab("scenarios");
      await loadAll();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "שגיאה בהוספת תסריטים");
    } finally {
      setBusy(false);
      if (appendFileRef.current) appendFileRef.current.value = "";
      if (appendImageRef.current) appendImageRef.current.value = "";
    }
  };

  const handleAppendFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !appendTarget) return;
    const target = appendTarget;
    try {
      let combinedContent = "";
      const names: string[] = [];
      for (const f of Array.from(files)) {
        toast.info(`מעבד את ${f.name}...`);
        const { content } = await parseFile(f);
        combinedContent += (combinedContent ? "\n\n" : "") + `# ${f.name}\n${content}`;
        names.push(f.name);
      }
      await appendScenariosToSpec(target, {
        specContent: combinedContent,
        specName: names.join(", "),
        images: [],
        appendedContent: combinedContent,
      });
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "שגיאה בקריאת הקובץ");
      if (appendFileRef.current) appendFileRef.current.value = "";
    }
  };

  const handleAppendImages = async (files: FileList | null) => {
    if (!files || files.length === 0 || !appendTarget) return;
    const target = appendTarget;
    try {
      const added: { name: string; dataUrl: string }[] = [];
      for (const f of Array.from(files)) {
        if (!/^image\/(png|jpe?g|webp)$/i.test(f.type)) {
          toast.error(`התמונה ${f.name} אינה בפורמט נתמך`);
          continue;
        }
        if (f.size > 10 * 1024 * 1024) {
          toast.error(`התמונה ${f.name} גדולה מ-10MB`);
          continue;
        }
        added.push({ name: f.name, dataUrl: await fileToDataUrl(f) });
      }
      if (added.length === 0) return;
      await appendScenariosToSpec(target, {
        specContent: "",
        specName: `תוספת תמונות (${added.length})`,
        images: added.map((i) => i.dataUrl),
        appendedContent: `(נוספו ${added.length} תמונות)\n` + added.map((i) => i.name).join("\n"),
      });
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "שגיאה בקריאת התמונות");
      if (appendImageRef.current) appendImageRef.current.value = "";
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

  const exportExcel = (rows?: Scenario[]) => {
    const list = rows && rows.length > 0 ? rows : scenarios;
    if (list.length === 0) {
      toast.warning("אין תסריטים לייצוא");
      return;
    }
    exportScenariosToExcel(
      list as any,
      `תסריטי-בדיקה-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
    toast.success("הקובץ ירד");
  };

  return (
    <div dir="rtl" className="min-h-screen text-right">
      <ThemeToggle />
      <BatteryProgress visible={progressVisible} progress={progress} />

      {/* Floating right toolbar */}
      <aside className="fixed right-4 top-1/2 z-30 -translate-y-1/2">
        <div className="glass-panel flex flex-col items-stretch gap-1 rounded-2xl p-2 shadow-lg backdrop-blur">
          <button
            type="button"
            onClick={() => setTab("upload")}
            className={`group flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition ${
              tab === "upload" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
            title="טעינת אפיון"
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
            title="תסריטים"
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
            title="שינויים ממתינים"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap">שינויים ממתינים</span>
            {changes.length > 0 && (
              <span className="mr-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs text-destructive-foreground">
                {changes.length}
              </span>
            )}
          </button>
          <div className="my-1 h-px bg-border" />
          <div className="px-1 py-1">
            <MondayAuthButton />
          </div>
        </div>
      </aside>

      {/* Hero */}
      <header className="relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-90"
          style={{ background: "var(--gradient-hero)" }}
        />
        <div className="relative mx-auto max-w-6xl px-6 py-8 text-primary-foreground">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col items-center text-center"
          >
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
              <Stat n={changes.length} label="ממתינים לעדכון" highlight={changes.length > 0} />
            </div>
          </motion.div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-6 py-10 pl-6 pr-6 lg:pl-6 lg:pr-44">
        <Tabs value={tab} onValueChange={setTab} dir="rtl">
          <TabsList className="sr-only">
            <TabsTrigger value="upload">טעינת אפיון</TabsTrigger>
            <TabsTrigger value="scenarios">תסריטים</TabsTrigger>
            <TabsTrigger value="changes">שינויים ממתינים</TabsTrigger>
          </TabsList>

          {/* Upload */}
          <TabsContent value="upload" className="mt-6 space-y-6">
            <Card
              className={`glass-panel relative overflow-hidden rounded-[2rem] p-6 text-right transition-all hover:shadow-[var(--shadow-elegant)] ${
                drag ? "ring-2 ring-primary" : ""
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                handleFiles(e.dataTransfer.files);
              }}
            >
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Sparkles className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-semibold">טעינת אפיון</h3>
              <p className="mt-1 max-w-4xl text-right text-sm leading-7 text-muted-foreground [text-wrap:pretty] md:mr-0 md:ml-auto">
                טענו קובץ אפיון פונקציונלי או טכני (PDF / Word / טקסט) ומלאו את מאפייני האפיון.
                המערכת תייצר תסריטי בדיקה חדשים, ובמקביל תבדוק האם האפיון משפיע על תסריטים קיימים
                ותציע עדכונים.
              </p>

              <div dir="rtl" className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <Label>מערכת</Label>
                  {me?.is_admin === false && (me?.systems?.length ?? 0) === 1 ? (
                    <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted px-3 text-sm font-medium text-foreground">
                      {me.systems[0].name}
                    </div>
                  ) : (
                    <Select
                      value={meta.system}
                      onValueChange={(v) => setMeta((m) => ({ ...m, system: v, module: "" }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="בחרו מערכת" />
                      </SelectTrigger>
                      <SelectContent>
                        {dynamicSystems.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>מודול</Label>
                  <Select
                    value={meta.module}
                    onValueChange={(v) => setMeta((m) => ({ ...m, module: v }))}
                    disabled={!meta.system || (MODULES_BY_SYSTEM[meta.system]?.length ?? 0) === 0}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          !meta.system
                            ? "בחרו קודם מערכת"
                            : (MODULES_BY_SYSTEM[meta.system]?.length ?? 0) === 0
                              ? "אין מודולים מוגדרים עדיין"
                              : "בחרו מודול"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(MODULES_BY_SYSTEM[meta.system] ?? []).map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>בודק אחראי</Label>
                  <Input
                    placeholder="שם הבודק"
                    value={meta.tester}
                    maxLength={100}
                    onChange={(e) => setMeta((m) => ({ ...m, tester: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>מיישם אחראי</Label>
                  <Input
                    placeholder="שם המיישם"
                    value={meta.implementer}
                    maxLength={100}
                    onChange={(e) => setMeta((m) => ({ ...m, implementer: e.target.value }))}
                  />
                </div>
              </div>

              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".pdf,.docx,.txt,.md,.xlsx,.xls,.csv,.json"
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
              <input
                ref={imageRef}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => handleImageFiles(e.target.files)}
              />

              <div dir="rtl" className="mt-6">
                <Button
                  className="glass-btn-primary h-14 w-full rounded-2xl text-base font-semibold"
                  disabled={busy}
                  onClick={() => {
                    if (!validateMeta()) return;
                    setChooserOpen(true);
                  }}
                >
                  {busy ? (
                    <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="ml-2 h-4 w-4" />
                  )}
                  {busy ? "מעבד..." : "טעינת אפיון ויצירת תסריטים"}
                </Button>
              </div>
              <p className="mt-2 text-right text-xs text-muted-foreground">
                או גררו קבצים לכאן · PDF, Word, טקסט. ניתן גם לצרף תמונות לניתוח.
              </p>

              <Dialog open={chooserOpen} onOpenChange={setChooserOpen}>
                <DialogContent dir="rtl" className="text-right">
                  <DialogHeader>
                    <DialogTitle className="text-right">מה ברצונך לטעון?</DialogTitle>
                    <DialogDescription className="text-right">
                      בחרו את מקור הקלט ליצירת התסריטים
                    </DialogDescription>
                  </DialogHeader>

                  <div className="rounded-lg border border-dashed bg-muted/30 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <ImagePlus className="h-4 w-4 text-primary" /> תמונות (אופציונלי)
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          צילומי מסך / סקיצות / תרשימים · עד 8 תמונות, 6MB כל אחת
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => imageRef.current?.click()}
                      >
                        <ImagePlus className="ml-2 h-4 w-4" /> צירוף תמונות
                      </Button>
                    </div>
                    {images.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {images.map((img, idx) => (
                          <div
                            key={idx}
                            className="group relative h-16 w-16 overflow-hidden rounded-md border bg-card"
                          >
                            <img
                              src={img.dataUrl}
                              alt={img.name}
                              className="h-full w-full object-cover"
                            />
                            <button
                              type="button"
                              onClick={() => setImages((prev) => prev.filter((_, i) => i !== idx))}
                              className="absolute left-1 top-1 rounded-full bg-background/80 p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                              title="הסר"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid gap-3">
                    <Button
                      variant="outline"
                      className="h-auto justify-start py-4 text-right"
                      onClick={() => {
                        if (images.length === 0) {
                          toast.error("יש לצרף תמונות תחילה");
                          return;
                        }
                        includeImagesRef.current = true;
                        setChooserOpen(false);
                        fileRef.current?.click();
                      }}
                    >
                      <div className="flex w-full items-start gap-3">
                        <FileText className="mt-1 h-5 w-5 text-primary" />
                        <div className="flex-1 text-right">
                          <div className="font-medium">אפיון + תמונות</div>
                          <div className="text-xs text-muted-foreground">
                            ניתוח משולב של מסמך האפיון יחד עם {images.length || 0} תמונות מצורפות
                          </div>
                        </div>
                      </div>
                    </Button>

                    <Button
                      variant="outline"
                      className="h-auto justify-start py-4 text-right"
                      onClick={() => {
                        includeImagesRef.current = false;
                        setChooserOpen(false);
                        fileRef.current?.click();
                      }}
                    >
                      <div className="flex w-full items-start gap-3">
                        <FileText className="mt-1 h-5 w-5 text-primary" />
                        <div className="flex-1 text-right">
                          <div className="font-medium">אפיון בלבד</div>
                          <div className="text-xs text-muted-foreground">
                            יצירת תסריטים על בסיס מסמך האפיון בלבד (תמונות מצורפות יתעלמו)
                          </div>
                        </div>
                      </div>
                    </Button>
                    <Button
                      variant="outline"
                      className="h-auto justify-start py-4 text-right"
                      onClick={() => {
                        if (images.length === 0) {
                          toast.error("יש לצרף תמונות תחילה");
                          return;
                        }
                        setChooserOpen(false);
                        generateFromImagesOnly();
                      }}
                    >
                      <div className="flex w-full items-start gap-3">
                        <ImagePlus className="mt-1 h-5 w-5 text-primary" />
                        <div className="flex-1 text-right">
                          <div className="font-medium">תמונות בלבד</div>
                          <div className="text-xs text-muted-foreground">
                            יצירת תסריטים על בסיס {images.length || 0} התמונות המצורפות בלבד
                          </div>
                        </div>
                      </div>
                    </Button>
                    <Button
                      variant="outline"
                      className="h-auto justify-start py-4 text-right"
                      onClick={() => {
                        setChooserOpen(false);
                        setMondayImportOpen(true);
                      }}
                    >
                      <div className="flex w-full items-start gap-3">
                        <Download className="mt-1 h-5 w-5 text-primary rotate-180" />
                        <div className="flex-1 text-right">
                          <div className="font-medium">ייבוא מ-Monday</div>
                          <div className="text-xs text-muted-foreground">
                            שליפת קבצי אפיון מצורפים מבורד לפי סטטוס
                          </div>
                        </div>
                      </div>
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>

              <Dialog open={mondayImportOpen} onOpenChange={setMondayImportOpen}>
                <DialogContent dir="rtl" className="text-right">
                  <DialogHeader>
                    <DialogTitle className="text-right">ייבוא אפיון מ-Monday</DialogTitle>
                    <DialogDescription className="text-right">
                      נשלפו כל הפריטים בבורד עם סטטוס נבחר, וכל הקבצים המצורפים יעובדו כאפיון.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label>Board ID</Label>
                      <Input
                        placeholder="לדוגמה: 4429586627"
                        value={mondayBoardId}
                        onChange={(e) => setMondayBoardId(e.target.value)}
                        dir="ltr"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>תווית סטטוס לסינון</Label>
                      <Input
                        placeholder='לדוגמה: "מוכן לבדיקה"'
                        value={mondayStatus}
                        onChange={(e) => setMondayStatus(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        המערכת תאתר את עמודת הסטטוס שמכילה תווית זו ותביא רק פריטים תואמים.
                      </p>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setMondayImportOpen(false)}>
                      ביטול
                    </Button>
                    <Button onClick={handleMondayImport} disabled={busy || mondayLoadingPreview}>
                      {mondayLoadingPreview ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Download className="ml-2 h-4 w-4 rotate-180" />}
                      טעינת רשימה
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog
                open={mondayPreview !== null}
                onOpenChange={(o) => { if (!o) setMondayPreview(null); }}
              >
                <DialogContent dir="rtl" className="text-right max-w-2xl">
                  <DialogHeader>
                    <DialogTitle className="text-right">בחר אפיונים לייבוא</DialogTitle>
                    <DialogDescription className="text-right">
                      {mondayPreview
                        ? `נמצאו ${mondayPreview.fresh.length} אפיונים חדשים${
                            mondayPreview.skipped.length > 0
                              ? ` (${mondayPreview.skipped.length} כבר יובאו בעבר)`
                              : ""
                          }. סמן את אלה שברצונך לייבא.`
                        : ""}
                    </DialogDescription>
                  </DialogHeader>

                  {mondayPreview && (
                    <div className="space-y-3">
                      {mondayPreview.fresh.length > 0 && (
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <button
                            type="button"
                            className="text-primary hover:underline"
                            onClick={() => {
                              const allIds = mondayPreview.fresh.map((m) => m.itemId);
                              setMondaySelected(
                                mondaySelected.size === allIds.length
                                  ? new Set()
                                  : new Set(allIds),
                              );
                            }}
                          >
                            {mondaySelected.size === mondayPreview.fresh.length
                              ? "נקה הכל"
                              : "סמן הכל"}
                          </button>
                          <span className="text-muted-foreground">
                            נבחרו {mondaySelected.size} מתוך {mondayPreview.fresh.length}
                          </span>
                        </div>
                      )}
                      <ScrollArea className="h-80 rounded-md border p-2">
                        <div className="space-y-1">
                          {mondayPreview.fresh.map((m) => (
                            <label
                              key={m.itemId}
                              className="flex cursor-pointer items-start gap-2 rounded p-2 hover:bg-muted/50"
                            >
                              <Checkbox
                                checked={mondaySelected.has(m.itemId)}
                                onCheckedChange={(c) => {
                                  setMondaySelected((prev) => {
                                    const next = new Set(prev);
                                    if (c) next.add(m.itemId);
                                    else next.delete(m.itemId);
                                    return next;
                                  });
                                }}
                                className="mt-0.5"
                              />
                              <div className="flex-1 text-sm">
                                <div className="font-medium">{m.itemName}</div>
                                <div className="text-xs text-muted-foreground">
                                  {m.assets.length} קבצים: {m.assets.map((a) => a.name).join(", ")}
                                </div>
                              </div>
                            </label>
                          ))}
                          {mondayPreview.skipped.length > 0 && (
                            <>
                              <Separator className="my-2" />
                              <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                                כבר יובאו בעבר (לא ניתנים לבחירה):
                              </div>
                              {mondayPreview.skipped.map((m) => (
                                <div
                                  key={m.itemId}
                                  className="flex items-start gap-2 rounded p-2 opacity-60"
                                >
                                  <Checkbox checked disabled className="mt-0.5" />
                                  <div className="flex-1 text-sm">
                                    <div className="font-medium line-through">{m.itemName}</div>
                                  </div>
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                      </ScrollArea>
                    </div>
                  )}

                  <DialogFooter>
                    <Button variant="outline" onClick={() => setMondayPreview(null)}>
                      ביטול
                    </Button>
                    <Button
                      onClick={handleMondayConfirm}
                      disabled={busy || mondaySelected.size === 0}
                    >
                      {busy ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Download className="ml-2 h-4 w-4 rotate-180" />}
                      ייבוא {mondaySelected.size > 0 ? `(${mondaySelected.size})` : ""}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

            </Card>

            {specs.length > 0 && (
              <Card className="mt-8 p-6">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                    <FileSearch className="h-4 w-4" /> אפיונים שהועלו
                  </h3>
                  <div className="relative w-full sm:w-64">
                    <Input
                      dir="rtl"
                      placeholder="חיפוש אפיון..."
                      value={specSearch}
                      onChange={(e) => setSpecSearch(e.target.value)}
                      className="h-8 pr-8 text-right text-sm"
                    />
                    <FileSearch className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </div>
                <div className="space-y-2">
                  {specs
                    .filter((s) =>
                      specSearch.trim()
                        ? s.name.toLowerCase().includes(specSearch.trim().toLowerCase())
                        : true
                    )
                    .slice(0, 8)
                    .map((s) => {
                    const expanded = expandedSpecs.has(s.id);
                    return (
                      <div
                        key={s.id}
                        className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-md border bg-card p-3"
                        dir="rtl"
                      >
                        {/* Actions */}
                        <div className="flex items-center gap-1 order-4 justify-self-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => removeSpec(s)}
                            title="הסר אפיון"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 shrink-0"
                            disabled={busy}
                            onClick={() => setAppendTarget(s)}
                            title="הוסף אפיון או תמונה לאפיון זה"
                          >
                            <Plus className="ml-1 h-3.5 w-3.5" /> הוסף
                          </Button>
                        </div>
                        {/* Date */}
                        <span className="order-3 shrink-0 text-xs text-muted-foreground tabular-nums">
                          {new Date(s.created_at).toLocaleString("he-IL")}
                        </span>
                        {/* Badges */}
                        <div className="order-2 flex min-w-0 flex-wrap items-center justify-start gap-1.5">
                          {(!(s.name.length > 40) || expanded) && (
                            <Badge variant="secondary" className="text-xs uppercase shrink-0">
                              {s.file_type}
                            </Badge>
                          )}
                          {s.system && (
                            <Badge variant="outline" className="text-xs shrink-0">
                              מערכת: {s.system}
                            </Badge>
                          )}
                          {s.module && (
                            <Badge variant="outline" className="text-xs shrink-0">
                              מודול: {s.module}
                            </Badge>
                          )}
                          {s.tester && (
                            <Badge variant="outline" className="text-xs shrink-0">
                              בודק: {s.tester}
                            </Badge>
                          )}
                          {s.implementer && (
                            <Badge variant="outline" className="text-xs shrink-0">
                              מיישם: {s.implementer}
                            </Badge>
                          )}
                        </div>
                        {/* Name */}
                        <div className="order-1 flex min-w-0 items-center gap-2">
                          <FileText className="h-4 w-4 shrink-0 text-primary" />

                          <span
                            className={`text-sm font-medium ${expanded ? "break-all" : "truncate"} max-w-[280px]`}
                            title={s.name}
                          >
                            {s.name}
                          </span>
                          {s.name.length > 40 && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedSpecs((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(s.id)) next.delete(s.id);
                                  else next.add(s.id);
                                  return next;
                                })
                              }
                              className="shrink-0 text-xs text-primary hover:underline"
                            >
                              {expanded ? "הסתר" : "הצג עוד"}
                            </button>
                          )}
                        </div>

                      </div>
                    );
                  })}
                </div>

              </Card>
            )}
          </TabsContent>

          {/* Scenarios */}
          <TabsContent value="scenarios" className="mt-6">
            <ScenariosPanel
              scenarios={scenarios}
              specs={specs}
              onDelete={deleteScenario}
              onExport={exportExcel}
            />
          </TabsContent>

          {/* Changes */}
          <TabsContent value="changes" className="mt-6">
            {changes.length === 0 ? (
              <EmptyState
                icon={<Check className="h-10 w-10" />}
                title="אין שינויים ממתינים"
                desc="כשתעלו אפיון מעודכן, עדכונים מוצעים יופיעו כאן לאישור"
              />
            ) : (
              <div className="space-y-3">
                {changes.map((c) => {
                  const original = scenarios.find((s) => s.id === c.scenario_id);
                  return (
                    <ChangeCard
                      key={c.id}
                      change={c}
                      original={original}
                      onAccept={() => acceptChange(c)}
                      onReject={() => rejectChange(c)}
                    />
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <input
          ref={appendFileRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md,.xlsx,.xls,.csv,.json"
          className="hidden"
          onChange={(e) => handleAppendFiles(e.target.files)}
        />
        <input
          ref={appendImageRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => handleAppendImages(e.target.files)}
        />

        <Dialog open={!!appendTarget} onOpenChange={(o) => !o && setAppendTarget(null)}>
          <DialogContent dir="rtl" className="text-right">
            <DialogHeader>
              <DialogTitle className="text-right">
                הוספת תוכן לאפיון "{appendTarget?.name}"
              </DialogTitle>
              <DialogDescription className="text-right">
                התסריטים החדשים שייווצרו ישוייכו לאפיון הקיים
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <Button
                variant="outline"
                className="h-auto justify-start py-4 text-right"
                disabled={busy}
                onClick={() => appendFileRef.current?.click()}
              >
                <div className="flex w-full items-start gap-3">
                  <FileText className="mt-1 h-5 w-5 text-primary" />
                  <div className="flex-1 text-right">
                    <div className="font-medium">הוספת מסמך אפיון</div>
                    <div className="text-xs text-muted-foreground">
                      PDF / Word / טקסט — ייווצרו תסריטים נוספים מהמסמך
                    </div>
                  </div>
                </div>
              </Button>
              <Button
                variant="outline"
                className="h-auto justify-start py-4 text-right"
                disabled={busy}
                onClick={() => appendImageRef.current?.click()}
              >
                <div className="flex w-full items-start gap-3">
                  <ImagePlus className="mt-1 h-5 w-5 text-primary" />
                  <div className="flex-1 text-right">
                    <div className="font-medium">הוספת תמונות</div>
                    <div className="text-xs text-muted-foreground">
                      צילומי מסך / סקיצות — ייווצרו תסריטים נוספים מהתמונות
                    </div>
                  </div>
                </div>
              </Button>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setAppendTarget(null)} disabled={busy}>
                ביטול
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>

      <footer className="border-t bg-card/50 py-6 text-right text-xs text-muted-foreground">
        QAI · בודקי תוכנה ראויים לכלים טובים
      </footer>
    </div>
  );
}

function Stat({ n, label, highlight }: { n: number; label: string; highlight?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative group">
        <div
          className={`absolute -inset-0.5 rounded-2xl blur-lg transition-opacity duration-500 ${
            highlight ? "bg-amber-500/30 opacity-100" : "bg-white/5 opacity-30 group-hover:opacity-50"
          }`}
        />
        <div
          className={`relative flex items-center justify-center w-24 h-28 rounded-2xl border backdrop-blur-2xl shadow-2xl overflow-hidden ${
            highlight
              ? "bg-gradient-to-br from-amber-400/15 via-amber-300/5 to-amber-500/10 border-amber-300/40 shadow-[0_8px_32px_rgba(245,158,11,0.25)]"
              : "bg-gradient-to-br from-white/15 via-white/5 to-white/10 border-white/20 shadow-[0_8px_32px_rgba(255,255,255,0.08)]"
          }`}
        >
          {/* Inner highlight ring for glass edge */}
          <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/15" />
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={n}
              initial={{ y: "-60%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "60%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 24 }}
              className={`text-5xl font-black tracking-tight leading-none tabular-nums drop-shadow-[0_2px_8px_rgba(0,0,0,0.25)] ${
                highlight ? "text-amber-300" : "text-white"
              }`}
            >
              {n}
            </motion.span>
          </AnimatePresence>
          {/* Glass gloss overlay */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-2xl bg-gradient-to-b from-white/25 via-white/10 to-transparent" />
          {/* Subtle bottom sheen */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-white/5 to-transparent" />
        </div>

      </div>
      <span
        className={`text-[13px] font-bold tracking-wide uppercase ${
          highlight ? "text-amber-500/80" : "text-white/50"
        }`}
      >
        {label}
      </span>
    </div>
  );
}

function UploadCard({
  title,
  desc,
  icon,
  busy,
  onFiles,
  cta,
  variant = "default",
}: {
  title: string;
  desc: string;
  icon: React.ReactNode;
  busy: boolean;
  onFiles: (f: FileList | null) => void;
  cta: string;
  variant?: "default" | "outline";
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <Card
      className={`relative overflow-hidden p-6 text-right transition-all hover:shadow-[var(--shadow-elegant)] ${
        drag ? "ring-2 ring-primary" : ""
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        onFiles(e.dataTransfer.files);
      }}
    >
      <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
      <input
        ref={ref}
        type="file"
        multiple
        accept=".pdf,.docx,.txt,.md,.xlsx,.xls,.csv,.json"
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
      <Button
        variant={variant}
        className="mt-5 w-full"
        disabled={busy}
        onClick={() => ref.current?.click()}
      >
        {busy ? (
          <Loader2 className="ml-2 h-4 w-4 animate-spin" />
        ) : (
          <Upload className="ml-2 h-4 w-4" />
        )}
        {busy ? "מעבד..." : cta}
      </Button>
      <p className="mt-2 text-right text-xs text-muted-foreground">
        או גררו קבצים לכאן · PDF, Word, טקסט
      </p>
    </Card>
  );
}

function ScenariosPanel({
  scenarios,
  specs,
  onDelete,
  onExport,
}: {
  scenarios: Scenario[];
  specs: Spec[];
  onDelete: (id: string) => void;
  onExport: (rows?: Scenario[]) => void;
}) {
  const specMap = new Map(specs.map((s) => [s.id, s]));
  const ALL = "__all__";
  const [fSystem, setFSystem] = useState(ALL);
  const [fModule, setFModule] = useState(ALL);
  const [fTester, setFTester] = useState(ALL);
  const [fImplementer, setFImplementer] = useState(ALL);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const uniq = (vals: (string | null | undefined)[]) =>
    Array.from(new Set(vals.filter((v): v is string => !!v && v.trim() !== ""))).sort();

  const systems = uniq(specs.map((s) => s.system));
  const modules = uniq(
    specs.filter((s) => fSystem === ALL || s.system === fSystem).map((s) => s.module),
  );
  const testers = uniq(specs.map((s) => s.tester));
  const implementers = uniq(specs.map((s) => s.implementer));

  const filtered = scenarios.filter((sc) => {
    const spec = sc.spec_id ? specMap.get(sc.spec_id) : undefined;
    if (fSystem !== ALL && spec?.system !== fSystem) return false;
    if (fModule !== ALL && spec?.module !== fModule) return false;
    if (fTester !== ALL && spec?.tester !== fTester) return false;
    if (fImplementer !== ALL && spec?.implementer !== fImplementer) return false;
    return true;
  });

  // Drop stale ids when filters/scenarios change
  useEffect(() => {
    setSelectedIds((prev) => {
      const valid = new Set(scenarios.map((s) => s.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (valid.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [scenarios]);

  const toggleOne = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const setMany = (ids: string[], on: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  const clearSelection = () => setSelectedIds(new Set());
  const selectAllFiltered = () => setSelectedIds(new Set(filtered.map((s) => s.id)));

  const selectedScenarios = filtered.filter((s) => selectedIds.has(s.id));
  const exportTarget = selectedScenarios.length > 0 ? selectedScenarios : filtered;
  const hasSelection = selectedScenarios.length > 0;

  const resetFilters = () => {
    setFSystem(ALL);
    setFModule(ALL);
    setFTester(ALL);
    setFImplementer(ALL);
  };
  const hasFilter = fSystem !== ALL || fModule !== ALL || fTester !== ALL || fImplementer !== ALL;

  return (
    <div dir="rtl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {hasSelection ? (
            <>
              נבחרו {selectedScenarios.length} מתוך {filtered.length} תסריטים
            </>
          ) : (
            <>
              {filtered.length} מתוך {scenarios.length} תסריטי בדיקה
            </>
          )}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {hasSelection ? (
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              נקה בחירה
            </Button>
          ) : (
            filtered.length > 0 && (
              <Button variant="ghost" size="sm" onClick={selectAllFiltered}>
                בחר הכל
              </Button>
            )
          )}
          <AutoRunFhirButton
            scenarios={(hasSelection ? selectedScenarios : filtered).filter((sc) =>
              isFhirScenario(sc, sc.spec_id ? specMap.get(sc.spec_id)?.system : undefined),
            )}
          />
          <MondayExportButton
            scenarios={exportTarget}
            specs={specs}
            label={hasSelection ? `ייצוא ${selectedScenarios.length} ל-Monday` : "ייצוא ל-Monday"}
          />
          <Button
            onClick={() => onExport(exportTarget)}
            disabled={exportTarget.length === 0}
          >
            <Download className="ml-2 h-4 w-4" />
            {hasSelection ? `ייצוא ${selectedScenarios.length} לאקסל` : "ייצוא לאקסל"}
          </Button>
        </div>


      </div>

      {scenarios.length > 0 && (
        <Card className="mb-4 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-muted-foreground">סינון לפי תיוגים</span>
            {hasFilter && (
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                נקה סינון
              </Button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FilterSelect
              label="מערכת"
              value={fSystem}
              onChange={(v) => {
                setFSystem(v);
                setFModule(ALL);
              }}
              options={systems}
              allValue={ALL}
            />
            <FilterSelect
              label="מודול"
              value={fModule}
              onChange={setFModule}
              options={modules}
              allValue={ALL}
            />
            <FilterSelect
              label="בודק"
              value={fTester}
              onChange={setFTester}
              options={testers}
              allValue={ALL}
            />
            <FilterSelect
              label="מיישם"
              value={fImplementer}
              onChange={setFImplementer}
              options={implementers}
              allValue={ALL}
            />
          </div>
        </Card>
      )}

      {scenarios.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="h-10 w-10" />}
          title="עדיין אין תסריטים"
          desc="טענו אפיון בלשונית 'טעינת אפיון' כדי להתחיל"
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FileSearch className="h-10 w-10" />}
          title="אין תסריטים תואמים לסינון"
          desc="נסו לשנות את התיוגים שנבחרו"
        />
      ) : (
        <GroupedScenarios
          filtered={filtered}
          specMap={specMap}
          onDelete={onDelete}
          onExport={onExport}
          selectedIds={selectedIds}
          toggleOne={toggleOne}
          setMany={setMany}
        />

      )}
    </div>
  );
}

function GroupedScenarios({
  filtered,
  specMap,
  onDelete,
  onExport,
  selectedIds,
  toggleOne,
  setMany,
}: {
  filtered: Scenario[];
  specMap: Map<string, Spec>;
  onDelete: (id: string) => void;
  onExport: (rows?: Scenario[]) => void;
  selectedIds: Set<string>;
  toggleOne: (id: string) => void;
  setMany: (ids: string[], on: boolean) => void;
}) {
  const UNASSIGNED_SYSTEM = "ללא מערכת";
  const UNASSIGNED_SPEC = "__no_spec__";

  // Group by system → spec
  const bySystem = new Map<string, Map<string, Scenario[]>>();
  for (const sc of filtered) {
    const spec = sc.spec_id ? specMap.get(sc.spec_id) : undefined;
    const sysKey = spec?.system?.trim() || UNASSIGNED_SYSTEM;
    const specKey = spec?.id || UNASSIGNED_SPEC;
    if (!bySystem.has(sysKey)) bySystem.set(sysKey, new Map());
    const specs = bySystem.get(sysKey)!;
    if (!specs.has(specKey)) specs.set(specKey, []);
    specs.get(specKey)!.push(sc);
  }

  const systemKeys = Array.from(bySystem.keys()).sort((a, b) => {
    if (a === UNASSIGNED_SYSTEM) return 1;
    if (b === UNASSIGNED_SYSTEM) return -1;
    return a.localeCompare(b, "he");
  });

  const [activeSystem, setActiveSystem] = useState<string>("__all__");

  useEffect(() => {
    if (activeSystem !== "__all__" && !bySystem.has(activeSystem)) {
      setActiveSystem("__all__");
    }
  }, [activeSystem, bySystem]);

  const renderSystem = (sysKey: string) => {
    const specsMap = bySystem.get(sysKey)!;
    const specKeys = Array.from(specsMap.keys());
    const sysTotal = specKeys.reduce((n, k) => n + specsMap.get(k)!.length, 0);
    return (
      <section key={sysKey} className="rounded-lg border bg-card/40">
        <header className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2.5">
          <h3 className="text-base font-bold">
            <span className="text-primary">מערכת:</span> {sysKey}
          </h3>
          <Badge variant="secondary">{sysTotal} תסריטים</Badge>
        </header>
        <div className="space-y-5 p-4">
          {specKeys.map((specKey) => {
            const items = specsMap.get(specKey)!;
            const spec = specKey === UNASSIGNED_SPEC ? undefined : specMap.get(specKey);
            return (
              <SpecGroup
                key={specKey}
                spec={spec}
                items={items}
                onDelete={onDelete}
                onExport={onExport}
                selectedIds={selectedIds}
                toggleOne={toggleOne}
                setMany={setMany}
              />
            );
          })}
        </div>
      </section>
    );
  };


  return (
    <Tabs value={activeSystem} onValueChange={setActiveSystem} dir="rtl">
      <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/40 p-1">
        <TabsTrigger value="__all__" className="gap-2">
          הכל
          <Badge variant="secondary">{filtered.length}</Badge>
        </TabsTrigger>
        {systemKeys.map((sysKey) => {
          const specsMap = bySystem.get(sysKey)!;
          const total = Array.from(specsMap.values()).reduce((n, arr) => n + arr.length, 0);
          return (
            <TabsTrigger key={sysKey} value={sysKey} className="gap-2">
              {sysKey}
              <Badge variant="secondary">{total}</Badge>
            </TabsTrigger>
          );
        })}
      </TabsList>

      <TabsContent value="__all__" className="mt-4">
        <div className="space-y-6">{systemKeys.map(renderSystem)}</div>
      </TabsContent>
      {systemKeys.map((sysKey) => (
        <TabsContent key={sysKey} value={sysKey} className="mt-4">
          {renderSystem(sysKey)}
        </TabsContent>
      ))}
    </Tabs>
  );
}

function SpecGroup({
  spec,
  items,
  onDelete,
  onExport,
  selectedIds,
  toggleOne,
  setMany,
}: {
  spec?: Spec;
  items: Scenario[];
  onDelete: (id: string) => void;
  onExport: (rows?: Scenario[]) => void;
  selectedIds: Set<string>;
  toggleOne: (id: string) => void;
  setMany: (ids: string[], on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ids = items.map((i) => i.id);
  const selectedCount = ids.filter((id) => selectedIds.has(id)).length;
  const allChecked = selectedCount === ids.length && ids.length > 0;
  const someChecked = selectedCount > 0 && !allChecked;
  return (
    <div className="overflow-hidden rounded-md border bg-background">
      <div className="flex w-full items-center justify-between gap-3 px-3 py-2.5">
        <div className="flex flex-1 items-center gap-2">
          <Checkbox
            checked={allChecked ? true : someChecked ? "indeterminate" : false}
            onCheckedChange={(v) => setMany(ids, v === true)}
            onClick={(e) => e.stopPropagation()}
            aria-label="בחר את כל התסריטים באפיון זה"
          />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex flex-1 items-center gap-2 text-right transition hover:opacity-80"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
            <span className="text-sm font-semibold">אפיון: {spec?.name || "ללא אפיון"}</span>
            {spec?.module && <Badge variant="outline">מודול: {spec.module}</Badge>}
          </button>
        </div>
        <div className="flex items-center gap-2">
          {selectedCount > 0 && (
            <Badge variant="default">{selectedCount} נבחרו</Badge>
          )}
          <Badge variant="secondary">{items.length} תסריטים</Badge>
          <MondayExportButton
            scenarios={items}
            specs={spec ? [spec] : []}
            size="sm"
            variant="outline"
            label="Monday"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              onExport(items);
            }}
            disabled={items.length === 0}
          >
            <Download className="ml-1 h-3.5 w-3.5" /> אקסל
          </Button>
        </div>
      </div>
      {open && (
        <div className="space-y-2 border-t bg-muted/20 p-3">
          {items.map((s) => (
            <ScenarioCard
              key={s.id}
              s={s}
              spec={spec}
              onDelete={() => onDelete(s.id)}
              selected={selectedIds.has(s.id)}
              onToggleSelect={() => toggleOne(s.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}


function FilterSelect({
  label,
  value,
  onChange,
  options,
  allValue,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  allValue: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={allValue}>הכל</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ScenarioCard({
  s,
  spec,
  onDelete,
  selected,
  onToggleSelect,
}: {
  s: Scenario;
  spec?: Spec;
  onDelete: () => void;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <Card className={`overflow-hidden ${selected ? "ring-2 ring-primary" : ""}`}>
        <div className="flex items-start gap-3 p-3">
          <Checkbox
            checked={selected}
            onCheckedChange={onToggleSelect}
            className="mt-2"
            aria-label="בחר תסריט"
          />
          <button
            onClick={() => setOpen(!open)}
            className="flex flex-1 items-start justify-between gap-4 rounded p-2 text-right transition-colors hover:bg-muted/40"
          >
            <div className="flex-1">

            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-base font-semibold">{s.title}</h4>
              <Badge className={`${PRIORITY_STYLE[s.priority]} border-0`}>
                {PRIORITY_LABEL[s.priority] ?? s.priority}
              </Badge>
              <Badge variant="outline">{TYPE_LABEL[s.type] ?? s.type}</Badge>
              {s.area && <Badge variant="secondary">{s.area}</Badge>}
              {spec?.system && (
                <Badge variant="outline" className="text-xs">
                  מערכת: {spec.system}
                </Badge>
              )}
              {spec?.module && (
                <Badge variant="outline" className="text-xs">
                  מודול: {spec.module}
                </Badge>
              )}
              {spec?.tester && (
                <Badge variant="outline" className="text-xs">
                  בודק: {spec.tester}
                </Badge>
              )}
              {spec?.implementer && (
                <Badge variant="outline" className="text-xs">
                  מיישם: {spec.implementer}
                </Badge>
              )}
            </div>
            {!open && s.expected_result && (
              <p className="mt-2 line-clamp-1 text-sm text-muted-foreground">{s.expected_result}</p>
            )}
          </div>
            <span className="text-xs text-muted-foreground">{open ? "סגור" : "פתח"}</span>
          </button>
        </div>

        {open && (
          <div className="space-y-4 border-t bg-muted/20 p-5 text-sm">
            {s.preconditions && (
              <div>
                <div className="mb-1 font-semibold text-muted-foreground">תנאים מקדימים</div>
                <div>{s.preconditions}</div>
              </div>
            )}
            <div>
              <div className="mb-1 font-semibold text-muted-foreground">צעדים</div>
              <ol className="list-decimal space-y-1 pr-5">
                {s.steps.map((st, i) => (
                  <li key={i}>{st}</li>
                ))}
              </ol>
            </div>
            {s.expected_result && (
              <div>
                <div className="mb-1 font-semibold text-muted-foreground">תוצאה צפויה</div>
                <div>{s.expected_result}</div>
              </div>
            )}
            {isFhirScenario(s, spec?.system) && (
              <>
                <Separator />
                <FhirActions scenario={s} />
              </>
            )}
            <Separator />
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" className="text-destructive" onClick={onDelete}>
                <Trash2 className="ml-1 h-4 w-4" /> מחק
              </Button>
            </div>

          </div>
        )}
      </Card>
    </motion.div>
  );
}

function FhirActions({ scenario }: { scenario: Scenario }) {
  const parsed = parseFhirScenario(scenario as any);
  const runFn = runFhirRequest;
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState(parsed?.method ?? "GET");
  const [url, setUrl] = useState(parsed?.url ?? "https://iris-qa.fhir.dev.idgmc.org/csp/healthshare/bneizion/fhir/r4/");
  const [body, setBody] = useState(parsed?.body ?? "");
  const [headersText, setHeadersText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const exportPostman = () => {
    const collection = buildPostmanCollection(scenario.title, [scenario as any]);
    const blob = new Blob([JSON.stringify(collection, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${scenario.title.replace(/[^\w\-א-ת ]+/g, "_").slice(0, 80)}.postman_collection.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Postman Collection הורד");
  };

  const run = async () => {
    if (!url.trim()) {
      toast.error("חסר URL");
      return;
    }
    let headers: Record<string, string> | undefined;
    if (headersText.trim()) {
      try {
        headers = JSON.parse(headersText);
      } catch {
        toast.error("Headers חייבים להיות JSON תקין");
        return;
      }
    }
    setBusy(true);
    setResult(null);
    try {
      const res = await runFn({
        data: {
          method: method as any,
          url: url.trim(),
          body: body.trim() || undefined,
          headers,
        },
      });
      setResult(res);
      if (res.ok) toast.success(`הצלחה ${res.status} (${res.durationMs}ms)`);
      else toast.warning(`${res.status || "שגיאה"} ${res.statusText} (${res.durationMs}ms)`);
    } catch (e: any) {
      toast.error(e?.message ?? "הריצה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="default" disabled={!parsed}>
            <Play className="ml-1 h-4 w-4" /> הרצה ידנית
          </Button>
        </DialogTrigger>
        <DialogContent dir="rtl" className="text-right max-w-3xl">
          <DialogHeader>
            <DialogTitle>הרצת בדיקת FHIR</DialogTitle>
            <DialogDescription>
              שולח את הבקשה ישירות לשרת ה-FHIR ומציג את התגובה.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-[120px_1fr] gap-2">
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://iris-qa.fhir.dev.idgmc.org/csp/healthshare/bneizion/fhir/r4/Patient/123" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Headers (JSON אופציונלי)</Label>
              <Textarea
                dir="ltr"
                rows={3}
                value={headersText}
                onChange={(e) => setHeadersText(e.target.value)}
                placeholder='{"Authorization":"Bearer ..."}'
              />
            </div>
            {!["GET", "HEAD"].includes(method) && (
              <div className="space-y-1">
                <Label className="text-xs">Body (JSON)</Label>
                <Textarea
                  dir="ltr"
                  rows={8}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={run} disabled={busy}>
                {busy ? "רץ..." : "הרץ עכשיו"}
              </Button>
            </div>
            {result && (
              <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-2" dir="ltr">
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant={result.ok ? "default" : "destructive"}>
                    {result.status || "ERR"} {result.statusText}
                  </Badge>
                  <span className="text-muted-foreground">{result.durationMs}ms</span>
                </div>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono">
{typeof result.bodyJson === "object" && result.bodyJson !== null
  ? JSON.stringify(result.bodyJson, null, 2)
  : result.bodyText}
                </pre>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Button size="sm" variant="outline" onClick={exportPostman} disabled={!parsed}>
        <Download className="ml-1 h-4 w-4" /> ייצוא ל-Postman
      </Button>
      {!parsed && (
        <span className="text-xs text-muted-foreground">
          לא זוהה Endpoint תקין בצעדי התסריט
        </span>
      )}
    </div>
  );
}

function AutoRunFhirButton({ scenarios }: { scenarios: Scenario[] }) {
  const runFn = runFhirRequest;
  const [busy, setBusy] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // suffixes[index of scenario in `runnable` below] = user-entered tail for templated URLs
  const [suffixes, setSuffixes] = useState<Record<number, string>>({});
  const [results, setResults] = useState<Array<{ title: string; ok: boolean; status: number; statusText: string; durationMs: number; error?: string }>>([]);
  const [progress, setProgress] = useState(0);

  // Build the list of runnable scenarios with their parsed FHIR requests.
  // אנחנו מריצים אך ורק GET — תסריטים עם method אחר (POST/PUT/PATCH/DELETE) נסוננים החוצה.
  const runnable = scenarios
    .map((s) => ({ s, parsed: parseFhirScenario(s as any) }))
    .filter((x): x is { s: Scenario; parsed: NonNullable<ReturnType<typeof parseFhirScenario>> } =>
      !!x.parsed && x.parsed.method.toUpperCase() === "GET",
    );

  const fhirCount = runnable.length;


  const templatedIdxs = runnable
    .map((r, i) => ({ r, i }))
    .filter((x) => x.r.parsed.isTemplated);

  const openSetup = () => {
    if (runnable.length === 0) {
      toast.error("אין תסריטי FHIR עם Endpoint תקין להרצה");
      return;
    }
    // Always clear creds + suffixes when opening — nothing persists between runs
    setUsername("");
    setPassword("");
    setSuffixes({});
    setSetupOpen(true);
  };

  const allSuffixesFilled = templatedIdxs.every((t) => (suffixes[t.i] ?? "").trim().length > 0);
  const canRun = !!username.trim() && !!password && allSuffixesFilled;

  const runAll = async () => {
    if (!canRun) {
      toast.error("יש למלא את כל השדות הנדרשים");
      return;
    }

    // Snapshot all inputs, then clear state so nothing lingers
    const creds = { username: username.trim(), password };
    const localSuffixes = { ...suffixes };
    setUsername("");
    setPassword("");
    setSuffixes({});
    setSetupOpen(false);

    setBusy(true);
    setResults([]);
    setProgress(0);
    setResultsOpen(true);
    const out: typeof results = [];
    try {
      for (let i = 0; i < runnable.length; i++) {
        const { s, parsed } = runnable[i];
        const finalUrl = parsed.isTemplated
          ? `${parsed.url}${(localSuffixes[i] ?? "").trim()}`
          : parsed.url;
        try {
          const res = await runFn({
            data: {
              method: parsed.method as any,
              url: finalUrl,
              body: parsed.body,
              basicAuth: creds,
            },
          });
          out.push({ title: s.title, ok: res.ok, status: res.status, statusText: res.statusText, durationMs: res.durationMs });
        } catch (e: any) {
          out.push({ title: s.title, ok: false, status: 0, statusText: "ERR", durationMs: 0, error: e?.message ?? "failed" });
        }
        setProgress(i + 1);
        setResults([...out]);
      }
    } finally {
      setBusy(false);
    }
    const okCount = out.filter((r) => r.ok).length;
    toast.success(`הסתיים: ${okCount}/${out.length} הצליחו`);
  };

  if (fhirCount === 0) return null;

  return (
    <>
      <Button size="sm" variant="secondary" onClick={openSetup} disabled={busy}>
        <Play className="ml-1 h-4 w-4" />
        {busy ? `רץ ${progress}/${fhirCount}...` : `הרצה אוטומטית (${fhirCount})`}
      </Button>

      {/* Setup dialog — credentials + per-scenario template suffixes. Nothing is stored. */}
      <Dialog
        open={setupOpen}
        onOpenChange={(o) => {
          setSetupOpen(o);
          if (!o) {
            setUsername("");
            setPassword("");
            setSuffixes({});
          }
        }}
      >
        <DialogContent dir="rtl" className="text-right max-w-2xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>הגדרות הרצה</DialogTitle>
            <DialogDescription>
              הפרטים שלמטה נשלחים רק עבור ההרצה הנוכחית ולא נשמרים בשום מקום.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runAll();
            }}
            className="space-y-4"
          >
            {/* Credentials */}
            <div className="space-y-3 rounded-md border p-3">
              <div className="text-sm font-semibold">התחברות לשרת FHIR</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="fhir-user">שם משתמש</Label>
                  <Input
                    id="fhir-user"
                    dir="ltr"
                    autoComplete="off"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="username"
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fhir-pass">סיסמה</Label>
                  <Input
                    id="fhir-pass"
                    dir="ltr"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
              </div>
            </div>

            {/* Templated URL suffixes */}
            {templatedIdxs.length > 0 && (
              <div className="space-y-3 rounded-md border p-3">
                <div className="text-sm font-semibold">
                  השלמת פרמטרים ({templatedIdxs.length})
                </div>
                <p className="text-xs text-muted-foreground">
                  באפיון נמצאו URLs שמסתיימים בקידומת. הזן את הסיומת לכל אחד (למשל לאחר <code dir="ltr">PAT.</code> כתוב <code dir="ltr">2195471</code>).
                </p>
                <div className="space-y-3 max-h-[40vh] overflow-y-auto overflow-x-hidden pl-1">
                  {templatedIdxs.map(({ r, i }) => {
                    const val = suffixes[i] ?? "";
                    return (
                      <div key={i} className="space-y-2 rounded-md bg-muted/30 p-2.5 overflow-hidden" dir="rtl">
                        <div className="text-right text-sm font-medium leading-5 whitespace-normal break-words [unicode-bidi:plaintext]">
                          {r.s.title}
                        </div>
                        <div className="grid w-full min-w-0 gap-1.5" dir="ltr">
                          <Input
                            dir="ltr"
                            className="w-full min-w-0 font-mono text-sm text-left"
                            value={val}
                            onChange={(e) =>
                              setSuffixes((prev) => ({ ...prev, [i]: e.target.value }))
                            }
                            placeholder="2195471"
                          />
                          <div
                            className="w-full min-w-0 truncate rounded-md border bg-muted px-2 py-1.5 text-left text-[11px] font-mono text-muted-foreground [unicode-bidi:plaintext]"
                            title={r.parsed.url}
                          >
                            {r.parsed.url}
                          </div>
                        </div>
                        {val.trim() && (
                          <div className="text-left text-[11px] text-muted-foreground font-mono break-all" dir="ltr">
                            → {r.parsed.url}{val.trim()}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setSetupOpen(false)}>
                ביטול
              </Button>
              <Button type="submit" disabled={!canRun}>
                <Play className="ml-1 h-4 w-4" />
                הרץ ({runnable.length})
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Results dialog */}
      <Dialog open={resultsOpen} onOpenChange={setResultsOpen}>
        <DialogContent dir="rtl" className="text-right max-w-3xl">
          <DialogHeader>
            <DialogTitle>הרצה אוטומטית של תסריטי FHIR</DialogTitle>
            <DialogDescription>
              {busy ? `מריץ ${progress} מתוך ${fhirCount}...` : `הסתיים: ${results.filter((r) => r.ok).length}/${results.length} הצליחו`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-auto">
            {results.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                <span className="truncate flex-1">{r.title}</span>
                <Badge variant={r.ok ? "default" : "destructive"}>
                  {r.status || "ERR"} {r.statusText}
                </Badge>
                <span className="text-xs text-muted-foreground tabular-nums">{r.durationMs}ms</span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ChangeCard({
  change,
  original,
  onAccept,
  onReject,
}: {
  change: ChangeRecord;
  original?: Scenario;
  onAccept: () => void;
  onReject: () => void;
}) {
  const p = change.proposed;
  const isNew = !change.scenario_id;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="border-r-4 border-r-[oklch(0.78_0.15_75)] p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge className="bg-[oklch(0.95_0.1_75)] text-[oklch(0.4_0.15_60)] border-0">
            {isNew ? "תסריט חדש" : "עדכון נדרש"}
          </Badge>
          <h4 className="font-semibold">{p.title}</h4>
        </div>
        <div className="mb-4 rounded-md bg-muted/40 p-3 text-sm">
          <div className="mb-1 font-semibold text-muted-foreground">סיבת השינוי</div>
          <div>{change.reason}</div>
        </div>

        {original && (
          <div className="mb-4 grid gap-3 md:grid-cols-2">
            <DiffPanel title="לפני" data={original} muted />
            <DiffPanel title="אחרי" data={p} />
          </div>
        )}
        {!original && <DiffPanel title="הצעה" data={p} />}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onReject}>
            <X className="ml-1 h-4 w-4" /> דחה
          </Button>
          <Button size="sm" onClick={onAccept}>
            <Check className="ml-1 h-4 w-4" /> אשר
          </Button>
        </div>
      </Card>
    </motion.div>
  );
}

function DiffPanel({ title, data, muted }: { title: string; data: any; muted?: boolean }) {
  return (
    <div
      className={`rounded-md border p-3 text-xs ${muted ? "bg-muted/30 opacity-80" : "bg-card"}`}
    >
      <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="font-semibold">{data.title}</div>
      {data.expected_result && (
        <div className="mt-1 text-muted-foreground">→ {data.expected_result}</div>
      )}
      {Array.isArray(data.steps) && (
        <ol className="mt-2 list-decimal space-y-0.5 pr-4">
          {data.steps.map((s: string, i: number) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

function EmptyState({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Card className="flex flex-col items-end justify-center p-12 text-right">
      <div className="mb-3 text-muted-foreground/60">{icon}</div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
    </Card>
  );
}

function MondayExportButton({
  scenarios,
  specs,
  size,
  variant = "outline",
  label = "ייצוא ל-Monday",
}: {
  scenarios: Scenario[];
  specs: Spec[];
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "default" | "outline" | "secondary" | "ghost";
  label?: string;
}) {
  const exportFn = useServerFn(exportScenariosToMonday);
  const [open, setOpen] = useState(false);
  const [boardId, setBoardId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setSelectedIds(new Set(scenarios.map((s) => s.id)));
    }
  }, [open, scenarios]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allSelected = scenarios.length > 0 && selectedIds.size === scenarios.length;
  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(scenarios.map((s) => s.id)));
  };

  const selected = scenarios.filter((s) => selectedIds.has(s.id));

  const submit = async () => {
    if (!/^\d+$/.test(boardId.trim())) {
      toast.error("יש להזין Board ID מספרי תקין");
      return;
    }
    if (selected.length === 0) {
      toast.error("יש לבחור לפחות תסריט אחד");
      return;
    }

    // קיבוץ לפי אפיון
    const specMap = new Map(specs.map((s) => [s.id, s]));
    const grouped = new Map<string, { specTitle: string; scenarios: Scenario[] }>();
    for (const s of selected) {
      const key = s.spec_id ?? "__unassigned__";
      const spec = s.spec_id ? specMap.get(s.spec_id) : undefined;
      const specTitle = spec?.name
        ? `${spec.system ? `אפיון ${spec.system} - ` : "אפיון - "}${spec.name}`
        : "תסריטים ללא אפיון";
      if (!grouped.has(key)) grouped.set(key, { specTitle, scenarios: [] });
      grouped.get(key)!.scenarios.push(s);
    }
    const groups = Array.from(grouped.entries()).map(([key, g]) => {
      const spec = key !== "__unassigned__" ? specMap.get(key) : undefined;
      return {
        specTitle: g.specTitle,
        system: spec?.system ?? null,
        scenarios: g.scenarios.map((s) => ({
          title: s.title,
          area: s.area,
          preconditions: s.preconditions,
          steps: s.steps ?? [],
          expected_result: s.expected_result,
          priority: s.priority,
          type: s.type,
        })),
      };
    });

    setBusy(true);
    try {
      const res = await exportFn({
        data: {
          boardId: boardId.trim(),
          groupId: groupId.trim() || undefined,
          groups,
        },
      });
      const skippedMsg =
        res.skippedScenarios > 0
          ? ` דולגו ${res.skippedScenarios} תסריטים שכבר קיימים: ${res.skipped.slice(0, 3).join(", ")}${res.skipped.length > 3 ? "…" : ""}.`
          : "";
      if (res.errors.length > 0) {
        toast.warning(
          `נוצרו ${res.itemsCreated} אפיונים ו-${res.subitemsCreated} תסריטים. ${res.errors.length} שגיאות.${skippedMsg}`,
        );
        console.warn("Monday export errors:", res.errors);
      } else if (res.subitemsCreated === 0 && res.skippedScenarios > 0) {
        toast.info(`כל התסריטים כבר קיימים ב-Monday. דולגו ${res.skippedScenarios}.`);
      } else {
        toast.success(
          `יוצאו ${res.itemsCreated} אפיונים ו-${res.subitemsCreated} תסריטים ל-Monday.${skippedMsg}`,
        );
      }
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "ייצוא ל-Monday נכשל");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} disabled={scenarios.length === 0}>
          <Upload className="ml-2 h-4 w-4" /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="text-right max-w-2xl">
        <DialogHeader>
          <DialogTitle>ייצוא תסריטים ל-Monday.com</DialogTitle>
          <DialogDescription>
            בחר אילו תסריטים לייצא. {selectedIds.size} מתוך {scenarios.length} מסומנים.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label htmlFor="monday-board">Board ID</Label>
            <Input
              id="monday-board"
              dir="ltr"
              placeholder="1234567890"
              value={boardId}
              onChange={(e) => setBoardId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">מופיע ב-URL של הלוח ב-Monday</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="monday-group">Group ID (אופציונלי)</Label>
            <Input
              id="monday-group"
              dir="ltr"
              placeholder="topics"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>תסריטים לייצוא</Label>
              <Button type="button" variant="ghost" size="sm" onClick={toggleAll}>
                {allSelected ? "נקה הכל" : "בחר הכל"}
              </Button>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
              {scenarios.map((s) => {
                const checked = selectedIds.has(s.id);
                return (
                  <label
                    key={s.id}
                    className="flex items-start gap-2 p-2 cursor-pointer hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(s.id)}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{s.title}</div>
                      {s.area && (
                        <div className="text-xs text-muted-foreground truncate">{s.area}</div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            ביטול
          </Button>
          <Button onClick={submit} disabled={busy || selectedIds.size === 0}>
            {busy ? (
              <Loader2 className="ml-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="ml-2 h-4 w-4" />
            )}
            {busy ? "מייצא..." : `ייצא (${selectedIds.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
