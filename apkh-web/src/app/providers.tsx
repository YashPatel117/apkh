"use client";

import { Provider } from "react-redux";
import { store } from "@/store/store";
import { ThemeProvider } from "@/components/ui/theme";
import { ToastProvider } from "@/components/ui/Toast";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Provider store={store}>
      <ThemeProvider>
        <ToastProvider>{children}</ToastProvider>
        <ServiceWorkerRegister />
      </ThemeProvider>
    </Provider>
  );
}
