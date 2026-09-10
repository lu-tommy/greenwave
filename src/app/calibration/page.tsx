import { NavBar } from "@/components/ui/NavBar";
import { CalibrationEditor } from "@/components/corridors/CalibrationEditor";

export default function CalibrationPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <NavBar />
      <CalibrationEditor />
    </div>
  );
}
