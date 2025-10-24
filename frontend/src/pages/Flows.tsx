import React from "react";
import { Alert, Button, Grid, IconButton, MenuItem, Paper, Stack, TextField, Typography, Select, FormControl, InputLabel } from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import { getFlowApi, saveFlowApi, listTemplatesApi, FlowDoc, FlowRule } from "../lib/api";

const emptyRule: FlowRule = { when: { type: "equals", value: "" }, action: { replyTemplateKey: "" } };

const FlowsPage: React.FC = () => {
    const [tenantId, setTenantId] = React.useState(localStorage.getItem("tenantId") ?? "");
    const [flow, setFlow] = React.useState<FlowDoc>({ rules: [] });
    const [tmplKeys, setTmplKeys] = React.useState<string[]>([]);
    const [result, setResult] = React.useState<any>(null);
    const [error, setError] = React.useState<string | null>(null);

    const load = async () => {
        if (!tenantId) return;
        const f = await getFlowApi(tenantId);
        setFlow(f ?? { rules: [] });
        const t = await listTemplatesApi(tenantId);
        setTmplKeys(t.map(x => x.key));
    };
    React.useEffect(() => { load(); }, [tenantId]);

    const updateRule = (idx: number, patch: Partial<FlowRule>) => {
        setFlow(prev => {
            const next = [...prev.rules];
            next[idx] = { ...next[idx], ...patch, when: { ...next[idx].when, ...(patch as any).when }, action: { ...next[idx].action, ...(patch as any).action } };
            return { ...prev, rules: next };
        });
    };
    const addRule = () => setFlow(prev => ({ ...prev, rules: [...prev.rules, { ...emptyRule }] }));
    const removeRule = (i: number) => setFlow(prev => ({ ...prev, rules: prev.rules.filter((_, idx) => idx !== i) }));

    const onSave = async () => {
        setError(null); setResult(null);
        const cleaned = { ...flow, rules: flow.rules.filter(r => r.when.value && r.action.replyTemplateKey) };
        const saved = await saveFlowApi(tenantId, cleaned);
        setFlow(saved);
        setResult({ ok: true });
    };

    return (
        <Paper sx={{ p: 3 }}>
            <Stack spacing={3}>
                <Typography variant="h6">Flow Builder</Typography>
                <TextField label="Tenant ID" value={tenantId} onChange={e => setTenantId(e.target.value)} required />

                <Stack spacing={2}>
                    {flow.rules.map((r, i) => (
                        <Paper key={i} variant="outlined" sx={{ p: 2 }}>
                            <Grid container spacing={2} alignItems="center">
                                <Grid item xs={12} md={3}>
                                    <FormControl fullWidth>
                                        <InputLabel id={`type-${i}`}>Match Type</InputLabel>
                                        <Select labelId={`type-${i}`} label="Match Type" value={r.when.type} onChange={e => updateRule(i, { when: { ...r.when, type: e.target.value as any } })}>
                                            <MenuItem value="equals">equals</MenuItem>
                                            <MenuItem value="contains">contains</MenuItem>
                                            <MenuItem value="regex">regex</MenuItem>
                                        </Select>
                                    </FormControl>
                                </Grid>
                                <Grid item xs={12} md={3}>
                                    <TextField label="Match Value" value={r.when.value} onChange={e => updateRule(i, { when: { ...r.when, value: e.target.value } })} fullWidth />
                                </Grid>
                                <Grid item xs={12} md={3}>
                                    <FormControl fullWidth>
                                        <InputLabel id={`tmpl-${i}`}>Reply Template</InputLabel>
                                        <Select labelId={`tmpl-${i}`} label="Reply Template" value={r.action.replyTemplateKey} onChange={e => updateRule(i, { action: { ...r.action, replyTemplateKey: String(e.target.value) } })}>
                                            {tmplKeys.map(k => <MenuItem key={k} value={k}>{k}</MenuItem>)}
                                        </Select>
                                    </FormControl>
                                </Grid>
                                <Grid item xs={12} md={2}>
                                    <TextField label="Set State (optional)" value={r.action.setState ?? ""} onChange={e => updateRule(i, { action: { ...r.action, setState: e.target.value || undefined } })} fullWidth />
                                </Grid>
                                <Grid item xs={12} md={1}>
                                    <IconButton aria-label="delete" onClick={() => removeRule(i)}><DeleteIcon /></IconButton>
                                </Grid>
                            </Grid>
                        </Paper>
                    ))}
                    <Button variant="outlined" onClick={addRule}>Add Rule</Button>
                </Stack>

                <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                        <FormControl fullWidth>
                            <InputLabel id="fallback">Fallback Template</InputLabel>
                            <Select labelId="fallback" label="Fallback Template" value={flow.fallbackTemplateKey ?? ""} onChange={e => setFlow(prev => ({ ...prev, fallbackTemplateKey: String(e.target.value || "") || undefined }))}>
                                <MenuItem value="">(none)</MenuItem>
                                {tmplKeys.map(k => <MenuItem key={k} value={k}>{k}</MenuItem>)}
                            </Select>
                        </FormControl>
                    </Grid>
                </Grid>

                <Button variant="contained" onClick={onSave}>Save Flow</Button>
                {result && <Alert severity="success">Saved.</Alert>}
                {error && <Alert severity="error">{error}</Alert>}
            </Stack>
        </Paper>
    );
};

export default FlowsPage;
