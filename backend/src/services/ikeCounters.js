export function ikeCounterDelta(session, snapshot, userId, pollMs) {
  const same = snapshot && snapshot.user_id === userId &&
    (!snapshot.session_identity || !session.identity || snapshot.session_identity === session.identity);
  const previous = same ? snapshot : null;
  const baseline = !previous && !snapshot && session.established > Math.ceil(pollMs / 1000) * 2;
  const delta = (value, last) => value >= last ? value - last : value;
  let incoming = baseline ? 0 : delta(session.bytesIn, Number(previous?.last_bytes_in || 0));
  let outgoing = baseline ? 0 : delta(session.bytesOut, Number(previous?.last_bytes_out || 0));
  let children = null;
  if (session.children?.length) {
    children = { ...(previous?.child_counters || {}) };
    if (previous?.child_counters) {
      incoming = 0; outgoing = 0;
      for (const child of session.children) {
        const last = children[child.key];
        incoming += delta(child.bytesIn, Number(last?.bytesIn || 0));
        outgoing += delta(child.bytesOut, Number(last?.bytesOut || 0));
      }
    }
    // Retain cursors of retiring children until this IKE SA disappears. A
    // temporarily absent CHILD must not be billed twice if it reappears.
    for (const child of session.children) children[child.key] = { bytesIn: child.bytesIn, bytesOut: child.bytesOut };
  }
  return { incoming, outgoing, total: incoming + outgoing, children };
}
