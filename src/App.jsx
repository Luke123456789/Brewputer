import { useEffect, useState } from "react";
import { supabase } from "./supabase.js";
import Dashboard from "./Dashboard.jsx";

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [isOwner, setIsOwner] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setIsOwner(null);
      return;
    }
    supabase.rpc("is_owner").then(({ data, error }) => setIsOwner(!error && data === true));
  }, [session]);

  if (session === undefined) return <div className="centre muted">Loading…</div>;
  if (!session) return <Login />;
  if (isOwner === null) return <div className="centre muted">Checking access…</div>;
  if (!isOwner) return <NotAuthorised session={session} />;
  return <Dashboard />;
}

function Login() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState("idle"); // idle | sending | sent | error
  const [error, setError] = useState("");

  async function send(e) {
    e.preventDefault();
    setState("sending");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      setError(error.message);
      setState("error");
    } else {
      setState("sent");
    }
  }

  return (
    <div className="login">
      <h1 className="brand">Brewputer</h1>
      {state === "sent" ? (
        <p>Check your email for a sign-in link. Open it on this device.</p>
      ) : (
        <form onSubmit={send}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" disabled={state === "sending"}>
            {state === "sending" ? "Sending…" : "Email me a sign-in link"}
          </button>
          {state === "error" && <p className="error">{error}</p>}
        </form>
      )}
    </div>
  );
}

function NotAuthorised({ session }) {
  return (
    <div className="login">
      <h1 className="brand">Brewputer</h1>
      <p>You're signed in, but this account hasn't been given access yet.</p>
      <p className="muted small">
        User ID: <code>{session.user.id}</code>
      </p>
      <button className="secondary" onClick={() => supabase.auth.signOut()}>
        Sign out
      </button>
    </div>
  );
}
