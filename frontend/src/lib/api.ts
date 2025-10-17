import axios from 'axios';

// Axios instance targeting Vite proxy (/api -> http://app:3000)
// This keeps browser calls same-origin to the dev server.
export const api = axios.create({
    baseURL: '/api',
    timeout: 10000
});

export type RegisterTenantBody = {
    name: string;
    phoneNumberId: string;
    accessToken: string;
    wabaId?: string;
};

export default api;
