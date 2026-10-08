"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EVENEMENT_NOTIFICATIONS } from "../../../components/shell/ClocheNotifications";
import { Alerte } from "../../../components/ui/Alerte";
import { Bouton } from "../../../components/ui/Bouton";
import { api, messageErreur } from "../../../lib/api";
import { formaterDateHeure } from "../../../lib/format";
import { lienNotification, paragraphes, type Notification } from "../../../lib/notifications";

function signaler() {
  window.dispatchEvent(new Event(EVENEMENT_NOTIFICATIONS));
}

/** « Tout marquer comme lu ». */
export function ToutLire({ nonLues }: { nonLues: number }) {
  const router = useRouter();
  const [etat, setEtat] = useState<{
    enCours: boolean;
    message: string | null;
    erreur: string | null;
  }>({
    enCours: false,
    message: null,
    erreur: null,
  });
  if (nonLues === 0 && !etat.message) return null;
  return (
    <div className="mp-pile">
      {etat.erreur ? (
        <Alerte tonalite="danger" titre="Action impossible">
          <p>{etat.erreur}</p>
        </Alerte>
      ) : null}
      {etat.message ? (
        <Alerte tonalite="succes" annonce="status">
          <p>{etat.message}</p>
        </Alerte>
      ) : null}
      {nonLues > 0 ? (
        <div>
          <Bouton
            variante="secondaire"
            icone="succes"
            chargement={etat.enCours}
            texteChargement="En cours…"
            onClick={async () => {
              setEtat({ enCours: true, message: null, erreur: null });
              try {
                const r = await api.post<{ marquees: number }>("/api/notifications/tout-lire");
                setEtat({
                  enCours: false,
                  erreur: null,
                  message:
                    r.marquees > 1
                      ? `${r.marquees} notifications marquées comme lues.`
                      : "Notification marquée comme lue.",
                });
                signaler();
                router.refresh();
              } catch (e) {
                setEtat({ enCours: false, message: null, erreur: messageErreur(e) });
              }
            }}
          >
            Tout marquer comme lu
          </Bouton>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Une notification : titre et corps en texte brut (React échappe tout : aucun HTML n'est
 * interprété), lien interne seulement. Ouvrir le lien la marque comme lue.
 */
export function ElementNotification({ n }: { n: Notification }) {
  const router = useRouter();
  const [lue, setLue] = useState(n.lue_le !== null);
  const [erreur, setErreur] = useState<string | null>(null);
  const lien = lienNotification(n.lien);

  async function marquer(): Promise<boolean> {
    if (lue) return true;
    try {
      await api.post(`/api/notifications/${encodeURIComponent(n.id)}/lue`);
      setLue(true);
      setErreur(null);
      signaler();
      return true;
    } catch (e) {
      setErreur(messageErreur(e));
      return false;
    }
  }

  return (
    <article
      className={lue ? "mp-notification" : "mp-notification mp-notification--non-lue"}
      aria-labelledby={`notif-${n.id}`}
    >
      <div className="mp-notification__entete">
        <h2 id={`notif-${n.id}`} className="mp-notification__titre">
          {lue ? null : <span className="mp-notification__pastille">Non lue</span>}
          {n.titre}
        </h2>
        <time className="mp-texte-doux mp-texte-petit" dateTime={n.cree_le}>
          {formaterDateHeure(n.cree_le)}
        </time>
      </div>
      {paragraphes(n.corps).map((p, i) => (
        <p key={i} className="mp-notification__corps">
          {p}
        </p>
      ))}
      {erreur ? (
        <p className="mp-champ__erreur" role="alert">
          {erreur}
        </p>
      ) : null}
      <div className="mp-barre-actions">
        {lien ? (
          <Link
            href={lien}
            className="mp-bouton mp-bouton--secondaire"
            onClick={() => {
              void marquer();
            }}
          >
            <span>Ouvrir</span>
          </Link>
        ) : null}
        {lue ? null : (
          <Bouton
            variante="discret"
            icone="succes"
            aria-label={`Marquer comme lue : ${n.titre}`}
            onClick={async () => {
              if (await marquer()) router.refresh();
            }}
          >
            Marquer comme lue
          </Bouton>
        )}
      </div>
    </article>
  );
}
