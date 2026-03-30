import axios, { AxiosInstance } from "axios";

const webApi = axios.create({
  baseURL: "http://localhost:3000",
  withCredentials: true,
});

const storageApi = axios.create({
  baseURL: "http://localhost:3001",
  withCredentials: true,
});

function requestInterceptor(apiInstance: AxiosInstance) {
  apiInstance.interceptors.request.use(
    (config) => {
      const token =
        typeof window !== "undefined" ? localStorage.getItem("token") : null;
      if (token && config.url !== "/auth/login") {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
    (error) => Promise.reject(error)
  );
}

function responseInterceptor(apiInstance: AxiosInstance) {
  apiInstance.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response?.status === 401) {
        if (typeof window !== "undefined") {
          window.location.href = "/login";
        }
      }
      return Promise.reject(error);
    }
  );
}

requestInterceptor(webApi);
responseInterceptor(webApi);

requestInterceptor(storageApi);
responseInterceptor(storageApi);

export { webApi, storageApi };
