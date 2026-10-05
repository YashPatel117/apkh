"use client";

import { Provider } from "react-redux";
import { store } from "@/store/store";
import { ThemeProvider } from "@/components/ui/theme";
import { ToastProvider } from "@/components/ui/Toast";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import { I18nProvider } from "@/i18n";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Provider store={store}>
      <I18nProvider>
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
          <ServiceWorkerRegister />
        </ThemeProvider>
      </I18nProvider>
    </Provider>
  );
}
