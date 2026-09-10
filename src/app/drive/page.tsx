import { NavBar } from "@/components/ui/NavBar";
import { DriveView } from "@/components/drive/DriveView";

export default function DrivePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <NavBar />
      <DriveView />
    </div>
  );
}
