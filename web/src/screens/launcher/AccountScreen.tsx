import { Link } from "react-router";
import { KeyArt } from "../../components/KeyArt";
import page from "./Page.module.css";

/** `/account`: a stub until member sign-in arrives (LW-3 fills this screen; the route stays). */
export function AccountScreen() {
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <KeyArt edition={null} dim={0.78} />
      <div className={page.page}>
        <h1 className={page.title}>ACCOUNT</h1>
        <div className={page.empty}>
          <p>Member sign-in comes in a later update. Until then, play as a guest.</p>
          <Link to="/" className={page.outline}>
            BACK TO PLAY
          </Link>
        </div>
      </div>
    </div>
  );
}
