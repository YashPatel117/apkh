"use client";

import { Provider } from "react-redux";
import { store } from "@/store/store";
import { ThemeProvider } from "@/components/ui/theme";
import { ToastProvider } from "@/components/ui/Toast";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Provider store={store}>
      <ThemeProvider>
        <ToastProvider>{children}</ToastProvider>
      </ThemeProvider>
    </Provider>
  );
}
