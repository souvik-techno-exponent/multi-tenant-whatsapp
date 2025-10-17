import React from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import App from './App';

// Minimal MUI theme (can be extended later)
const theme = createTheme({
    palette: {
        mode: 'light',
        primary: { main: '#1976d2' }
    }
});

const rootEl = document.getElementById('root')!;
createRoot(rootEl).render(
    <React.StrictMode>
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <App />
        </ThemeProvider>
    </React.StrictMode>
);
