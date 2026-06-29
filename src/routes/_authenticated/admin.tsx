import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowRight, Trash2, Plus, UserPlus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  listUsers,
  createUser,
  deleteUser,
  listSystems,
  createSystem,
  deleteSystem,
  assignUserSystems,
  listSystemCatalog,
  addSystemCatalog,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
});

function AdminPage() {
  const qc = useQueryClient();
  const listUsersFn = useServerFn(listUsers);
  const listSystemsFn = useServerFn(listSystems);

  const { data: users = [] } = useQuery({ queryKey: ["admin", "users"], queryFn: () => listUsersFn() });
  const { data: systems = [] } = useQuery({ queryKey: ["admin", "systems"], queryFn: () => listSystemsFn() });

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">ניהול משתמשים ומערכות</h1>
        <Button asChild variant="ghost"><Link to="/"><ArrowRight className="ml-1 h-4 w-4" /> חזרה</Link></Button>
      </div>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">משתמשים</TabsTrigger>
          <TabsTrigger value="systems">מערכות</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-4">
          <CreateUserForm systems={systems} onCreated={() => qc.invalidateQueries({ queryKey: ["admin", "users"] })} />
          <Card className="p-4">
            <h2 className="font-semibold mb-3">משתמשים קיימים</h2>
            <div className="space-y-3">
              {users.map((u: any) => (
                <UserRow key={u.id} user={u} systems={systems} onChanged={() => qc.invalidateQueries({ queryKey: ["admin", "users"] })} />
              ))}
              {users.length === 0 && <p className="text-sm text-muted-foreground">אין משתמשים.</p>}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="systems" className="space-y-4">
          <CreateSystemForm onCreated={() => qc.invalidateQueries({ queryKey: ["admin", "systems"] })} />
          <Card className="p-4">
            <h2 className="font-semibold mb-3">מערכות קיימות</h2>
            <div className="space-y-2">
              {systems.map((s: any) => (
                <SystemRow key={s.id} system={s} onDeleted={() => {
                  qc.invalidateQueries({ queryKey: ["admin", "systems"] });
                  qc.invalidateQueries({ queryKey: ["admin", "users"] });
                }} />
              ))}
              {systems.length === 0 && <p className="text-sm text-muted-foreground">אין מערכות.</p>}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CreateUserForm({ systems, onCreated }: { systems: any[]; onCreated: () => void }) {
  const fn = useServerFn(createUser);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [selectedSystems, setSelectedSystems] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await fn({ data: { email, password, full_name: fullName, is_admin: isAdmin, system_ids: selectedSystems } });
      toast.success("משתמש נוצר");
      setEmail(""); setPassword(""); setFullName(""); setIsAdmin(false); setSelectedSystems([]);
      onCreated();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setLoading(false); }
  };

  return (
    <Card className="p-4">
      <h2 className="font-semibold mb-3 flex items-center gap-2"><UserPlus className="h-4 w-4" /> יצירת משתמש</h2>
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1"><Label>אימייל</Label><Input dir="ltr" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="space-y-1"><Label>סיסמה</Label><Input dir="ltr" type="text" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <div className="space-y-1 md:col-span-2"><Label>שם מלא (אופציונלי)</Label><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
        <div className="md:col-span-2 flex items-center gap-2">
          <Checkbox id="admin" checked={isAdmin} onCheckedChange={(v) => setIsAdmin(!!v)} />
          <Label htmlFor="admin">סופר-יוזר (מנהל)</Label>
        </div>
        <div className="md:col-span-2 space-y-2">
          <Label>שייך למערכות</Label>
          <div className="flex flex-wrap gap-2">
            {systems.map((s: any) => {
              const checked = selectedSystems.includes(s.id);
              return (
                <button type="button" key={s.id} onClick={() => setSelectedSystems((p) => checked ? p.filter((x) => x !== s.id) : [...p, s.id])}
                  className={`px-3 py-1 rounded-full border text-sm ${checked ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>
                  {s.name}
                </button>
              );
            })}
            {systems.length === 0 && <p className="text-sm text-muted-foreground">אין מערכות עדיין — הוסף בטאב "מערכות".</p>}
          </div>
        </div>
        <div className="md:col-span-2"><Button type="submit" disabled={loading}>{loading ? "יוצר..." : "צור משתמש"}</Button></div>
      </form>
    </Card>
  );
}

function UserRow({ user, systems, onChanged }: { user: any; systems: any[]; onChanged: () => void }) {
  const assignFn = useServerFn(assignUserSystems);
  const delFn = useServerFn(deleteUser);
  const [selected, setSelected] = useState<string[]>(user.systems.map((s: any) => s.id));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await assignFn({ data: { user_id: user.id, system_ids: selected } });
      toast.success("נשמר");
      onChanged();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!confirm(`למחוק את ${user.email}?`)) return;
    try { await delFn({ data: { user_id: user.id } }); toast.success("נמחק"); onChanged(); }
    catch (e: any) { toast.error(e.message); }
  };

  return (
    <Card className="p-3 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="font-medium">{user.email}</div>
          {user.full_name && <div className="text-xs text-muted-foreground">{user.full_name}</div>}
        </div>
        <div className="flex items-center gap-2">
          {user.roles.includes("admin") && <Badge variant="default">מנהל-על</Badge>}
          <Button variant="ghost" size="sm" onClick={remove}><Trash2 className="h-4 w-4 text-destructive" /></Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {systems.map((s: any) => {
          const checked = selected.includes(s.id);
          return (
            <button type="button" key={s.id} onClick={() => setSelected((p) => checked ? p.filter((x) => x !== s.id) : [...p, s.id])}
              className={`px-3 py-1 rounded-full border text-xs ${checked ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>
              {s.name}
            </button>
          );
        })}
        {systems.length === 0 && (
          <p className="text-xs text-muted-foreground">אין מערכות להצגה — הוסף תחילה מערכת בטאב "מערכות".</p>
        )}
      </div>
      <div><Button size="sm" onClick={save} disabled={saving || systems.length === 0}>{saving ? "שומר..." : "שמור שיוך מערכות"}</Button></div>
    </Card>
  );
}

function CreateSystemForm({ onCreated }: { onCreated: () => void }) {
  const qc = useQueryClient();
  const fn = useServerFn(createSystem);
  const listCatalogFn = useServerFn(listSystemCatalog);
  const addCatalogFn = useServerFn(addSystemCatalog);
  const { data: catalog = [] } = useQuery({ queryKey: ["admin", "system_catalog"], queryFn: () => listCatalogFn() });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [newCatalogName, setNewCatalogName] = useState("");
  const [addingCatalog, setAddingCatalog] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) { toast.error("בחר שם מערכת"); return; }
    setLoading(true);
    try {
      await fn({ data: { name, description } });
      toast.success("מערכת נוספה");
      setName(""); setDescription("");
      onCreated();
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  const addToCatalog = async () => {
    if (!newCatalogName.trim()) return;
    setAddingCatalog(true);
    try {
      await addCatalogFn({ data: { name: newCatalogName.trim() } });
      toast.success("נוסף לרשימה");
      setName(newCatalogName.trim());
      setNewCatalogName("");
      qc.invalidateQueries({ queryKey: ["admin", "system_catalog"] });
    } catch (e: any) { toast.error(e.message); }
    finally { setAddingCatalog(false); }
  };

  return (
    <Card className="p-4">
      <h2 className="font-semibold mb-3 flex items-center gap-2"><Plus className="h-4 w-4" /> הוספת מערכת</h2>
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label>שם המערכת</Label>
          <Select value={name} onValueChange={setName}>
            <SelectTrigger><SelectValue placeholder="בחרו מערכת" /></SelectTrigger>
            <SelectContent>
              {catalog.map((c: any) => (
                <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
              ))}
              {catalog.length === 0 && (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">אין ערכים ברשימה</div>
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label>תיאור (אופציונלי)</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="md:col-span-2 flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label className="text-xs text-muted-foreground">הוספת ערך חדש לרשימת המערכות</Label>
            <Input placeholder="שם מערכת חדש" value={newCatalogName} onChange={(e) => setNewCatalogName(e.target.value)} />
          </div>
          <Button type="button" variant="outline" onClick={addToCatalog} disabled={addingCatalog || !newCatalogName.trim()}>
            {addingCatalog ? "מוסיף..." : "הוסף לרשימת הבחירה בלבד"}
          </Button>
        </div>
        <div className="md:col-span-2"><Button type="submit" disabled={loading}>{loading ? "מוסיף..." : "הוסף מערכת למערכת"}</Button></div>
      </form>
    </Card>
  );
}

function SystemRow({ system, onDeleted }: { system: any; onDeleted: () => void }) {
  const fn = useServerFn(deleteSystem);
  const remove = async () => {
    if (!confirm(`למחוק את המערכת ${system.name}?`)) return;
    try { await fn({ data: { id: system.id } }); toast.success("נמחק"); onDeleted(); }
    catch (e: any) { toast.error(e.message); }
  };
  return (
    <div className="flex items-center justify-between border rounded p-2">
      <div>
        <div className="font-medium">{system.name}</div>
        {system.description && <div className="text-xs text-muted-foreground">{system.description}</div>}
      </div>
      <Button variant="ghost" size="sm" onClick={remove}><Trash2 className="h-4 w-4 text-destructive" /></Button>
    </div>
  );
}
