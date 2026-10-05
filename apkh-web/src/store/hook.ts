import { TypedUseSelectorHook, useDispatch, useSelector, useStore } from "react-redux";
import type { RootState, AppDispatch, store } from "./store";

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
/** The store itself, for reading state inside callbacks without re-rendering on it. */
export const useAppStore = () => useStore<RootState>() as typeof store;
