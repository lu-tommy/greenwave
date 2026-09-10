import { NavBar } from "@/components/ui/NavBar";
import { CalibrationEditor } from "@/components/corridors/CalibrationEditor";

export default function CalibrationPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <NavBar />
      <CalibrationEditor />
    </div>
  );
}
