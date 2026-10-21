import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Shell } from "~/components/shell";
import { ToastProvider } from "~/components/toast";
import "./app.css";

export default function App() {
  return (
    <Router
      root={(props) => (
        <ToastProvider>
          <Shell>{props.children}</Shell>
        </ToastProvider>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
