import { Source_Serif_4 } from "next/font/google";
import { PortalProjectsClient } from "./portal-projects-client";

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-pexlo-serif",
  display: "swap",
});

export default function PortalProjectsPage() {
  return (
    <div className={`${sourceSerif.variable} rounded-[2rem] bg-pexlo-paper p-1 sm:p-2`}>
      <PortalProjectsClient />
    </div>
  );
}
