import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/archivo-black";
import "@fontsource-variable/space-grotesk";
import "@fontsource/jetbrains-mono/500.css";
import "./styles.css";
import App from "./App";
import { WalletProvider } from "./near/wallet";
import { ToastProvider } from "./components/Toast";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <WalletProvider>
        <App />
      </WalletProvider>
    </ToastProvider>
  </StrictMode>,
);
