import {
  Briefcase,
  Download,
  ImagePlus,
  Lock,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface ProPlanFeature {
  label: string;
  Icon: LucideIcon;
}

export const PRO_PLAN_FEATURES: ProPlanFeature[] = [
  { label: "Best-In-Class Coding Model", Icon: Sparkles },
  { label: "Download Projects", Icon: Download },
  { label: "Attach Screenshots For Reference", Icon: ImagePlus },
  { label: "Use Projects Commercially", Icon: Briefcase },
  { label: "Keep Projects Private", Icon: Lock },
  { label: "Team Collaboration", Icon: Users },
];

export const PRO_PLAN_FEATURE_LABELS = PRO_PLAN_FEATURES.map((feature) => feature.label);
