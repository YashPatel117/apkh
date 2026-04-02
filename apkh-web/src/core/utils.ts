export const stopPropagation = (fn?: (e: React.MouseEvent) => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn?.(e);
};