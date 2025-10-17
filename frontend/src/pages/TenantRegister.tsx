import React from 'react';
import {
    Alert, Button, Grid, Paper, Stack, TextField, Typography
} from '@mui/material';
import api, { RegisterTenantBody } from '../lib/api';

const TenantRegister: React.FC = () => {
    const [form, setForm] = React.useState<RegisterTenantBody>({
        name: '',
        phoneNumberId: '',
        accessToken: ''
    });
    const [loading, setLoading] = React.useState(false);
    const [result, setResult] = React.useState<any>(null);
    const [error, setError] = React.useState<string | null>(null);

    const onChange = (key: keyof RegisterTenantBody) => (e: React.ChangeEvent<HTMLInputElement>) => {
        setForm(prev => ({ ...prev, [key]: e.target.value }));
    };

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setResult(null);
        try {
            const resp = await api.post('/tenants/register', form);
            setResult(resp.data);
            const id = resp.data?.tenant?.id;
            const name = resp.data?.tenant?.name;
            if (id) {
                localStorage.setItem('tenantId', id);
                if (name) localStorage.setItem('tenantName', name);
            }
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
                    <Typography variant="h6">Register Tenant (PoC)</Typography>
                    <Typography variant="body2" color="text.secondary">
                        Sends <code>POST /tenants/register</code> with required fields.
                    </Typography>
                    <Grid container spacing={2}>
                        <Grid item xs={12} md={6}>
                            <TextField
                                label="Tenant name"
                                value={form.name}
                                onChange={onChange('name')}
                                required
                                fullWidth
                            />
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <TextField
                                label="Phone Number ID"
                                value={form.phoneNumberId}
                                onChange={onChange('phoneNumberId')}
                                required
                                fullWidth
                            />
                        </Grid>
                        <Grid item xs={12}>
                            <TextField
                                label="Access Token"
                                value={form.accessToken}
                                onChange={onChange('accessToken')}
                                required
                                fullWidth
                            />
                        </Grid>
                        <Grid item xs={12}>
                            <TextField
                                label="WABA ID (optional)"
                                value={form.wabaId ?? ''}
                                onChange={onChange('wabaId')}
                                fullWidth
                            />
                        </Grid>
                    </Grid>
                    <Button type="submit" variant="contained" disabled={loading}>
                        {loading ? 'Submitting…' : 'Register'}
                    </Button>
                    {result && (
                        <Alert severity="success">
                            Registered. Tenant ID:&nbsp;
                            <strong>{result?.tenant?.id}</strong>
                        </Alert>
                    )}
                    {error && <Alert severity="error">{error}</Alert>}
                </Stack>
            </form>
        </Paper>
    );
};

export default TenantRegister;
