import { SxProps } from "@mui/material";

export const modalStyle = (width?: number): SxProps => {
  return {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: width ?? null,
    bgcolor: "background.paper",
    border: "2px solid #000",
    boxShadow: 24,
    p: 3,
    borderRadius: 2,
  };
};
