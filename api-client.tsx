import axios from "axios";
import { authStore } from "../store"; // Path to your Zustand store
import { isTokenExpired } from "./jwtHooks";

const apiClient = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL ?? 'https://localhost:8000/',
    headers: {
        "Content-Type": "application/json",
    },
});

// Token refreshing logic
let isRefreshing = false;
let refreshSubscribers: {
    resolve: (newAccessToken: string) => void;
    reject: (error: unknown) => void;
}[] = [];

// Notify all subscribers with the new token or reject them
const onTokenRefreshed = (newAccessToken: string) => {
    refreshSubscribers.forEach(({ resolve }) => resolve(newAccessToken));
    refreshSubscribers = [];
};

const onTokenRefreshFailed = (error: unknown) => {
    refreshSubscribers.forEach(({ reject }) => reject(error));
    refreshSubscribers = [];
};

// Add a callback to the list of subscribers
const addRefreshSubscriber = (resolve: (newAccessToken: string) => void, reject: (error: unknown) => void) => {
    refreshSubscribers.push({ resolve, reject });
};

// Axios Request Interceptor
apiClient.interceptors.request.use(async (config) => {
    const accessToken = authStore.getState().getJwt();
    if (accessToken && !isTokenExpired(accessToken)) {
        config.headers["Authorization"] = `Bearer ${accessToken}`;
        return config;
    }

    // Handle token expiration
    if (!isRefreshing) {
        isRefreshing = true;
        try {
            const newAccessToken = await refreshToken();
            onTokenRefreshed(newAccessToken);
        } catch (error) {
            onTokenRefreshFailed(error); // Reject all pending requests
            throw error; // Allow this request to fail too
        } finally {
            isRefreshing = false;
        }
    }

    // Queue the current request
    return new Promise((resolve, reject) => {
        addRefreshSubscriber(
            (newAccessToken) => {
                config.headers["Authorization"] = `Bearer ${newAccessToken}`;
                resolve(config);
            },
            (error) => {
                reject(error); // Reject the request if token refresh fails
            }
        );
    });
});

// Function to refresh the token
async function refreshToken() {
    const baseURL = import.meta.env.VITE_API_BASE_URL ?? 'https://localhost:8000/';
    const maxRetries = 3; // Maximum number of retry attempts
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            const response = await axios.post(baseURL + "token/refresh/");
            const newAccessToken = response.data.access;

            // Update the auth store with the new token
            authStore.getState().setJwt(newAccessToken);
            return newAccessToken; // Return the new token on success
        } catch (error: unknown) {
            attempt++;
            console.warn("Token refresh failed:", error);
            if (attempt >= maxRetries) {
                console.error(`Failed to refresh token after ${maxRetries} attempts.`);
                throw new Error("Token refresh failed after multiple retries.");
            }

            // Exponential backoff: wait before retrying
            const waitTime = 2 ** attempt * 100; // e.g., 100ms, 200ms, 400ms
            console.warn(`Retrying token refresh (attempt ${attempt})...`);
            await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
    }

    throw new Error("Token refresh failed."); // Failsafe (shouldn't reach here)
}

// Axios Response Interceptor
apiClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        if (error.response?.status === 401 && !originalRequest._retry) {
            originalRequest._retry = true;

            if (isRefreshing) {
                // Wait until the token refresh completes
                return new Promise((resolve, reject) => {
                    addRefreshSubscriber(
                        (newAccessToken) => {
                            originalRequest.headers["Authorization"] = `Bearer ${newAccessToken}`;
                            resolve(apiClient(originalRequest));
                        },
                        (error) => {
                            reject(error); // Reject if token refresh fails
                        }
                    );
                });
            }

            try {
                const newAccessToken = await refreshToken();
                apiClient.defaults.headers["Authorization"] = `Bearer ${newAccessToken}`;
                return apiClient(originalRequest);
            } catch (refreshError) {
                authStore.getState().logout();
                return Promise.reject(refreshError);
            }
        }

        return Promise.reject(error);
    }
);

export default apiClient;
