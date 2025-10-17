import React from 'react';
import {
    Alert, Button, Grid, Paper, Stack, TextField, Typography
} from '@mui/material';
import api from '../lib/api';

const SendMessage: React.FC = () => {
    const [tenantId, setTenantId] = React.useState<string>(localStorage.getItem('tenantId') ?? '');
    const [to, setTo] = React.useState<string>('');
    const [text, setText] = React.useState<string>('');
    const [idempotencyKey, setIdempotencyKey] = React.useState<string>('');
    const [loading, setLoading] = React.useState(false);
    const [result, setResult] = React.useState<any>(null);
    const [error, setError] = React.useState<string | null>(null);

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setResult(null);
        setError(null);
        try {
            const payload: Record<string, any> = { to, text };
            if (idempotencyKey.trim()) payload.idempotency_key = idempotencyKey.trim();
            const resp = await api.post(`/tenants/${tenantId}/send`, payload);
            setResult(resp.data);
        } catch (e: any) {
            setError(e?.response?.data?.error ?? e?.message ?? 'Request failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Paper sx={{ p: 3 }}>
            <form onSubmit={onSubmit}>
                <Stack spacing={2}>
                    <Typography variant="h6">Send Message</Typography>
                    <Typography variant="body2" color="text.secondary">
                        Sends <code>POST /tenants/:tenantId/send</code> with <code>to</code>, <code>text</code> (+ optional <code>idempotency_key</code>).
                    </Typography>
                    <Grid container spacing={2}>
                        <Grid item xs={12}>
                            <TextField
                                label="Tenant ID"
                                value={tenantId}
                                onChange={(e) => setTenantId(e.target.value)}
                                required
                                fullWidth
                            />
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <TextField
                                label="To (E.164, e.g. +919012345678)"
                                value={to}
                                onChange={(e) => setTo(e.target.value)}
                                required
                                fullWidth
                            />
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <TextField
                                label="Idempotency Key (optional)"
                                value={idempotencyKey}
                                onChange={(e) => setIdempotencyKey(e.target.value)}
                                placeholder="order-1234"
                                fullWidth
                            />
                        </Grid>
                        <Grid item xs={12}>
                            <TextField
                                label="Text"
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                                required
                                multiline
                                minRows={3}
                                fullWidth
                            />
                        </Grid>
                    </Grid>
                    <Button type="submit" variant="contained" disabled={loading || !tenantId}>
                        {loading ? 'Sending…' : 'Send'}
                    </Button>
                    {result && (
                        <Alert severity="success">
                            Queued. Message ID:&nbsp;<strong>{result?.messageId ?? '(unknown)'}</strong>
                            {result?.idempotency_key ? <> — Key: <code>{result.idempotency_key}</code></> : null}
                            {result?.note ? <> — <em>{result.note}</em></> : null}
                        </Alert>
                    )}
                    {error && <Alert severity="error">{error}</Alert>}
                </Stack>
            </form>
        </Paper>
    );
};

export default SendMessage;
