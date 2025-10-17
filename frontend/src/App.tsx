import React from 'react';
import {
    AppBar, Box, Button, Container, Tab, Tabs, Toolbar, Typography
} from '@mui/material';
import HealthCheck from './pages/HealthCheck';
import TenantRegister from './pages/TenantRegister';
import SendMessage from './pages/SendMessage';

// Simple tab-based UI to exercise backend endpoints.
// Industry-standard patterns kept simple for PoC.

function a11yProps(index: number) {
    return {
        id: `main-tab-${index}`,
        'aria-controls': `main-tabpanel-${index}`,
    };
}

const TabPanel: React.FC<{ index: number; value: number }> = ({ index, value, children }) => {
    return (
        <div
            role="tabpanel"
            hidden={value !== index}
            id={`main-tabpanel-${index}`}
            aria-labelledby={`main-tab-${index}`}
        >
            {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
        </div>
    );
};

const App: React.FC = () => {
    const [value, setValue] = React.useState(0);
    const handleChange = (_: React.SyntheticEvent, newValue: number) => setValue(newValue);

    const clearStoredTenant = () => {
        localStorage.removeItem('tenantId');
        localStorage.removeItem('tenantName');
        window.alert('Cleared stored tenant info.');
    };

    const storedTenantId = localStorage.getItem('tenantId');
    const storedTenantName = localStorage.getItem('tenantName');

    return (
        <Box>
            <AppBar position="static">
                <Toolbar>
                    <Typography variant="h6" sx={{ flexGrow: 1 }}>
                        WhatsApp Multi-Tenant PoC UI
                    </Typography>
                    {storedTenantId ? (
                        <Button color="inherit" onClick={clearStoredTenant}>
                            Clear Tenant
                        </Button>
                    ) : null}
                </Toolbar>
            </AppBar>

            <Container maxWidth="md">
                <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                    <Tabs value={value} onChange={handleChange} aria-label="main tabs">
                        <Tab label="Health" {...a11yProps(0)} />
                        <Tab label="Register Tenant" {...a11yProps(1)} />
                        <Tab label="Send Message" {...a11yProps(2)} />
                    </Tabs>
                </Box>

                <TabPanel value={value} index={0}>
                    <HealthCheck />
                </TabPanel>
                <TabPanel value={value} index={1}>
                    <TenantRegister />
                </TabPanel>
                <TabPanel value={value} index={2}>
                    <SendMessage />
                    {storedTenantId ? (
                        <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
                            Using stored tenant:&nbsp;
                            <strong>{storedTenantName ?? '(no name)'}</strong> / <code>{storedTenantId}</code>
                        </Typography>
                    ) : (
                        <Typography variant="body2" sx={{ mt: 2, color: 'warning.main' }}>
                            No stored tenant ID. Register one first or paste a valid ID.
                        </Typography>
                    )}
                </TabPanel>
            </Container>
        </Box>
    );
};

export default App;
