import React from 'react';
import { Alert, Button, Paper, Stack, Typography } from '@mui/material';
import api from '../lib/api';

const HealthCheck: React.FC = () => {
    const [loading, setLoading] = React.useState(false);
    const [ok, setOk] = React.useState<boolean | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    const check = async () => {
        try {
            setLoading(true);
            setError(null);
            setOk(null);
            const resp = await api.get('/health');
            setOk(Boolean(resp.data?.ok));
        } catch (e: any) {
            setError(e?.message ?? 'Request failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Paper sx={{ p: 3 }}>
            <Stack spacing={2}>
                <Typography variant="h6">Health check</Typography>
                <Typography variant="body2" color="text.secondary">
                    Calls <code>GET /health</code> on the backend.
                </Typography>
                <Button variant="contained" onClick={check} disabled={loading}>
                    {loading ? 'Checking…' : 'Check'}
                </Button>
                {ok === true && <Alert severity="success">Backend is healthy (ok: true)</Alert>}
                {ok === false && <Alert severity="warning">Unexpected response.</Alert>}
                {error && <Alert severity="error">{error}</Alert>}
            </Stack>
        </Paper>
    );
};

export default HealthCheck;
