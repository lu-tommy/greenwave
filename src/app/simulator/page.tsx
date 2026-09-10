import { NavBar } from "@/components/ui/NavBar";
import { SimulatorView } from "@/components/simulator/SimulatorView";

export default function SimulatorPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <NavBar />
      <SimulatorView />
    </div>
  );
}
