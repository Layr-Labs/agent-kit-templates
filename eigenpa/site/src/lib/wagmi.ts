import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { mainnet } from "wagmi/chains";

export const wagmiConfig = getDefaultConfig({
  appName: "EigenPA",
  projectId: import.meta.env.VITE_WC_PROJECT_ID ?? "PLACEHOLDER",
  chains: [mainnet],
});
