import { SxProps } from "@mui/material";

export const modalStyle = (width?: number | string): SxProps => {
  return {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: width ?? { xs: "94vw", md: "84vw", xl: "72vw" },
    maxWidth: "1100px",
    maxHeight: "92vh",
    overflowY: "auto",
    bgcolor: "rgba(248, 250, 252, 0.98)",
    border: "1px solid rgba(226, 232, 240, 0.95)",
    boxShadow: "0 32px 90px -42px rgba(15, 23, 42, 0.55)",
    backdropFilter: "blur(16px)",
    p: { xs: 2, md: 3 },
    borderRadius: "28px",
  };
};
