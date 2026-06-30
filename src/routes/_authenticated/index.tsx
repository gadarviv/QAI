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

  const [progress, setProgress] = useState(0);
  const [progressVisible, setProgressVisible] = useState(false);

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
  const downloadMondayFn = useServerFn(downloadMonday
