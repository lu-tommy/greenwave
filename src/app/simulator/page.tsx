import { NavBar } from "@/components/ui/NavBar";
import { SimulatorView } from "@/components/simulator/SimulatorView";

export default function SimulatorPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <NavBar />
      <SimulatorView />
    </div>
  );
}
