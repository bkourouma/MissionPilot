"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import {
  actionsCommentaire,
  libelleDelaiModification,
  messageCommentaire,
  secondesRestantes,
  segmentsCommentaire,
  type Commentaire,
} from "../../lib/commentaires";
import { formaterDateHeure } from "../../lib/format";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Bouton } from "../ui/Bouton";
import { Squelette } from "../ui/Squelette";
import { EditionCommentaire } from "./CommentairesSaisie";

function TexteCommentaire({ c }: { c: Commentaire }) {
  return (
    <p className="mp-commentaire__texte">
      {segmentsCommentaire(c.texte ?? "", c.mentions).map((s, i) =>
        s.type === "mention" ? (
          <strong key={i} className="mp-mention">
            {s.valeur}
          </strong>
        ) : (
          <span key={i}>{s.valeur}</span>
        ),
      )}
    </p>
  );
}

export function ElementCommentaire({
  c,
  utilisateurId,
  associe,
  maintenant,
  onMaj,
}: {
  c: Commentaire;
  utilisateurId: string;
  associe: boolean;
  maintenant: number;
  onMaj: (c: Commentaire) => void;
}) {
  const t = useT();
  const langue = useLangue();
  const [edition, setEdition] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const a = actionsCommentaire(c, utilisateurId, associe, maintenant);
  const delai = a.modifier
    ? libelleDelaiModification(secondesRestantes(c.modifiable_jusqu_au, maintenant), langue)
    : null;
  const auteur =
    c.auteur_id === utilisateurId ? `${c.auteur_nom} ${t("(vous)", "(you)")}` : c.auteur_nom;

  async function supprimer(): Promise<boolean> {
    setErreur(null);
    try {
      await api.supprimer(`/api/commentaires/${encodeURIComponent(c.id)}`);
      onMaj({
        ...c,
        supprime: true,
        texte: null,
        mentions: [],
        supprime_le: new Date().toISOString(),
        supprime_par: utilisateurId,
      });
      return true;
    } catch (e) {
      setErreur(messageCommentaire(e, langue));
      return false;
    }
  }

  return (
    <li className={c.supprime ? "mp-commentaire mp-commentaire--supprime" : "mp-commentaire"}>
      <div className="mp-commentaire__entete">
        <strong>{auteur}</strong>
        <span className="mp-texte-doux mp-texte-petit">
          <time dateTime={c.cree_le}>{formaterDateHeure(c.cree_le, undefined, langue)}</time>
          {c.modifie_le && !c.supprime ? ` · ${t("modifié", "edited")}` : null}
        </span>
      </div>
      {c.supprime ? (
        <p className="mp-commentaire__texte mp-texte-doux">
          {c.supprime_le
            ? t(
                `Commentaire supprimé le ${formaterDateHeure(c.supprime_le)}.`,
                `Comment deleted on ${formaterDateHeure(c.supprime_le, undefined, langue)}.`,
              )
            : t("Commentaire supprimé.", "Comment deleted.")}
        </p>
      ) : edition ? (
        <EditionCommentaire
          c={c}
          onFin={(x) => {
            setEdition(false);
            if (x) onMaj(x);
          }}
        />
      ) : (
        <TexteCommentaire c={c} />
      )}
      {erreur ? (
        <p className="mp-champ__erreur" role="alert">
          {erreur}
        </p>
      ) : null}
      {!edition && (a.modifier || a.supprimer || a.historique) ? (
        <div className="mp-commentaire__actions">
          {delai ? <span className="mp-texte-doux mp-texte-petit">{delai}</span> : null}
          {a.modifier ? (
            <Bouton
              variante="discret"
              icone="crayon"
              onClick={() => setEdition(true)}
              aria-label={t(
                `Modifier votre commentaire du ${formaterDateHeure(c.cree_le)}`,
                `Edit your comment from ${formaterDateHeure(c.cree_le, undefined, langue)}`,
              )}
            >
              {t("Modifier", "Edit")}
            </Bouton>
          ) : null}
          {a.supprimer ? (
            <BoutonConfirmation
              libelle={t("Supprimer", "Delete")}
              variante="discret"
              icone="corbeille"
              ariaLabel={t(
                `Supprimer le commentaire de ${c.auteur_nom} du ${formaterDateHeure(c.cree_le)}`,
                `Delete the comment by ${c.auteur_nom} from ${formaterDateHeure(c.cree_le, undefined, langue)}`,
              )}
              question={t(
                "Supprimer ce commentaire ? Le fil gardera la trace de sa suppression.",
                "Delete this comment? The thread will keep a trace of its deletion.",
              )}
              libelleConfirmation={t("Oui, supprimer", "Yes, delete")}
              texteChargement={t("Suppression…", "Deleting…")}
              action={supprimer}
            />
          ) : null}
        </div>
      ) : null}
      {a.historique && !edition ? <Historique key={c.modifie_le} id={c.id} /> : null}
    </li>
  );
}

/** Versions successives d'un commentaire modifié, chargées à l'ouverture. */
function Historique({ id }: { id: string }) {
  const t = useT();
  const langue = useLangue();
  const [etat, setEtat] = useState<
    | { phase: "ferme" }
    | { phase: "chargement" }
    | { phase: "erreur"; message: string }
    | { phase: "pret"; versions: { texte: string; cree_le: string }[] }
  >({ phase: "ferme" });

  async function ouvrir() {
    if (etat.phase === "pret" || etat.phase === "chargement") return;
    setEtat({ phase: "chargement" });
    try {
      const r = await api.get<{ elements: { texte: string; cree_le: string }[] }>(
        `/api/commentaires/${encodeURIComponent(id)}/historique`,
      );
      setEtat({ phase: "pret", versions: r.elements });
    } catch (e) {
      setEtat({ phase: "erreur", message: messageCommentaire(e, langue) });
    }
  }

  return (
    <details
      className="mp-details mp-commentaire__historique"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) void ouvrir();
      }}
    >
      <summary>{t("Historique des modifications", "Edit history")}</summary>
      {etat.phase === "chargement" ? (
        <Squelette lignes={2} libelle={t("Chargement de l'historique…", "Loading history…")} />
      ) : etat.phase === "erreur" ? (
        <p className="mp-champ__erreur" role="alert">
          {etat.message}
        </p>
      ) : etat.phase === "pret" ? (
        <ol className="mp-commentaire__versions">
          {etat.versions.map((v, i) => (
            <li key={`${v.cree_le}-${i}`}>
              <span className="mp-texte-doux mp-texte-petit">
                {i === 0
                  ? t("Texte initial, ", "Original text, ")
                  : t(`Modification ${i}, `, `Edit ${i}, `)}
                <time dateTime={v.cree_le}>{formaterDateHeure(v.cree_le, undefined, langue)}</time>
              </span>
              <p className="mp-commentaire__texte">{v.texte}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </details>
  );
}
