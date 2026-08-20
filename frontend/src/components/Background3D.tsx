export default function Background3D() {
  return (
    <>
      <div className="pointer-events-none fixed -right-32 -top-40 h-[28rem] w-[28rem] rounded-full bg-[var(--accent-2)]/18 blur-[120px]" />
      <div className="pointer-events-none fixed -left-32 top-1/3 h-[22rem] w-[22rem] rounded-full bg-[var(--accent)]/16 blur-[120px]" />
      <div className="pointer-events-none fixed inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black/10 to-transparent" />
    </>
  );
}
