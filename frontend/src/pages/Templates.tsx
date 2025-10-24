import React from "react";
import { Alert, Button, Grid, Paper, Stack, TextField, Typography, Checkbox, FormControlLabel, Divider, MenuItem, Select, InputLabel, FormControl } from "@mui/material";
import { listTemplatesApi, upsertTemplateApi, sendTemplateApi, TemplateItem } from "../lib/api";

// Simple client-side mustache-style preview (same regex as backend)
function renderPreview(body: string, vars: Record<string, string>) {
    return body.replace(/{{\s*([\w.-]+)\s*}}/g, (_m, g1) => vars[g1] ?? "");
}

const TemplatesPage: React.FC = () => {
    const [tenantId, setTenantId] = React.useState(localStorage.getItem("tenantId") ?? "");
    const [items, setItems] = React.useState<TemplateItem[]>([]);
    const [form, setForm] = React.useState({ key: "", body: "", description: "", isActive: true, variablesCsv: "" });
    const [previewVarsJson, setPreviewVarsJson] = React.useState<string>('{"name":"Souvik","brand":"Acme"}');
    const [sendTo, setSendTo] = React.useState<string>("");
    const [sendKey, setSendKey] = React.useState<string>("");
    const [result, setResult] = React.useState<any>(null);
    const [error, setError] = React.useState<string | null>(null);

    const load = async () => {
        if (!tenantId) return;
        const list = await listTemplatesApi(tenantId);
        setItems(list);
    };
    React.useEffect(() => { load(); }, [tenantId]);

    const onUpsert = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null); setResult(null);
        const variables = form.variablesCsv.split(",").map(s => s.trim()).filter(Boolean);
        await upsertTemplateApi(tenantId, { key: form.key.trim(), body: form.body, variables, description: form.description, isActive: form.isActive });
        await load();
        setResult({ msg: "Saved" });
    };

    const onSend = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null); setResult(null);
        try {
            const vars = JSON.parse(previewVarsJson || "{}");
            const resp = await sendTemplateApi(tenantId, { to: sendTo.trim(), templateKey: sendKey, variables: vars });
            setResult(resp);
        } catch (err: any) {
            setError(err?.message ?? "Failed");
        }
    };

    let varsPreview: Record<string, string> = {};
    try { varsPreview = JSON.parse(previewVarsJson || "{}"); } catch { /* ignore */ }
    const livePreview = renderPreview(form.body, varsPreview);

    return (
        <Paper sx={{ p: 3 }}>
            <Stack spacing={3}>
                <Typography variant="h6">Templates</Typography>

                <Grid container spacing={2} component="form" onSubmit={onUpsert}>
                    <Grid item xs={12} md={6}>
                        <TextField label="Tenant ID" value={tenantId} onChange={e => setTenantId(e.target.value)} required fullWidth />
                    </Grid>
                    <Grid item xs={12} md={6}>
                        <TextField label="Key" value={form.key} onChange={e => setForm({ ...form, key: e.target.value })} required fullWidth />
                    </Grid>
                    <Grid item xs={12}>
                        <TextField label="Body (use {{var}})" value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} required multiline minRows={3} fullWidth />
                    </Grid>
                    <Grid item xs={12} md={6}>
                        <TextField label="Variables (comma separated)" value={form.variablesCsv} onChange={e => setForm({ ...form, variablesCsv: e.target.value })} fullWidth />
                    </Grid>
                    <Grid item xs={12} md={6}>
                        <TextField label="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} fullWidth />
                    </Grid>
                    <Grid item xs={12}>
                        <FormControlLabel control={<Checkbox checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} />} label="Active" />
                    </Grid>
                    <Grid item xs={12} md={6}>
                        <TextField label="Preview Variables (JSON)" value={previewVarsJson} onChange={e => setPreviewVarsJson(e.target.value)} multiline minRows={3} fullWidth />
                    </Grid>
                    <Grid item xs={12} md={6}>
                        <Typography variant="subtitle2">Live Preview</Typography>
                        <Paper variant="outlined" sx={{ p: 2, minHeight: 96, whiteSpace: "pre-wrap" }}>{livePreview || "(empty)"}</Paper>
                    </Grid>
                    <Grid item xs={12}>
                        <Button type="submit" variant="contained">Save Template</Button>
                    </Grid>
                </Grid>

                <Divider />
                <Typography variant="subtitle1">Existing (active) templates</Typography>
                <Stack spacing={1}>
                    {items.map(t => (
                        <Paper key={t._id} variant="outlined" sx={{ p: 2 }}>
                            <Typography><strong>{t.key}</strong> — v{t.version} {t.isActive ? "" : "(inactive)"}</Typography>
                            <Typography variant="body2" color="text.secondary">{t.description}</Typography>
                            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mt: 1 }}>{t.body}</Typography>
                        </Paper>
                    ))}
                </Stack>

                <Divider />
                <Typography variant="subtitle1">Send a template message (quick test)</Typography>
                <Grid container spacing={2} component="form" onSubmit={onSend}>
                    <Grid item xs={12} md={4}>
                        <TextField label="To (+E.164)" value={sendTo} onChange={e => setSendTo(e.target.value)} required fullWidth />
                    </Grid>
                    <Grid item xs={12} md={4}>
                        <FormControl fullWidth>
                            <InputLabel id="tmpl-key">Template</InputLabel>
                            <Select labelId="tmpl-key" value={sendKey} label="Template" onChange={e => setSendKey(String(e.target.value))}>
                                {items.map(i => <MenuItem key={i._id} value={i.key}>{i.key}</MenuItem>)}
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid item xs={12} md={4}>
                        <Button type="submit" variant="contained" sx={{ mt: 1.5 }} disabled={!sendKey}>Send</Button>
                    </Grid>
                </Grid>

                {result && <Alert severity="success">OK</Alert>}
                {error && <Alert severity="error">{error}</Alert>}
            </Stack>
        </Paper>
    );
};

export default TemplatesPage;
