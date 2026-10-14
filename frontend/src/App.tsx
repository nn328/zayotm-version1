import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { RoleProvider } from "@/components/RoleContext";
import AppShell from "@/components/layout/AppShell";
import Overview from "@/pages/Overview";
import DataWorkspace from "@/pages/DataWorkspace";
import IntelligenceCenter from "@/pages/IntelligenceCenter";
import DecisionStudio from "@/pages/DecisionStudio";
import QuantumLab from "@/pages/QuantumLab";
import TrustCenter from "@/pages/TrustCenter";
import AuditViewer from "@/pages/AuditViewer";
import SettingsPage from "@/pages/SettingsPage";

export default function App() {
  return (
    <RoleProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Overview />} />
          <Route path="/data" element={<DataWorkspace />} />
          <Route path="/ai-intelligence" element={<IntelligenceCenter />} />
          <Route path="/decision-studio" element={<DecisionStudio />} />
          <Route path="/decision-studio/:caseId" element={<DecisionStudio />} />
          <Route path="/quantum-lab" element={<QuantumLab />} />
          <Route path="/trust-blockchain" element={<TrustCenter />} />
          <Route path="/audit-viewer" element={<AuditViewer />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toaster position="bottom-right" />
    </RoleProvider>
  );
}
