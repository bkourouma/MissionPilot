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
  const [edition, setEdition] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const a = actionsCommentaire(c, utilisateurId, associe, maintenant);
  const delai = a.modifier
    ? libelleDelaiModification(secondesRestantes(c.modifiable_jusqu_au, maintenant))
    : null;
  const auteur = c.auteur_id === utilisateurId ? `${c.auteur_nom} (vous)` : c.auteur_nom;

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
      setErreur(messageCommentaire(e));
      return false;
    }
  }

  return (
    <li className={c.supprime ? "mp-commentaire mp-commentaire--supprime" : "mp-commentaire"}>
      <div className="mp-commentaire__entete">
        <strong>{auteur}</strong>
        <span className="mp-texte-doux mp-texte-petit">
          <time dateTime={c.cree_le}>{formaterDateHeure(c.cree_le)}</time>
          {c.modifie_le && !c.supprime ? " · modifié" : null}
        </span>
      </div>
      {c.supprime ? (
        <p className="mp-commentaire__texte mp-texte-doux">
          {c.supprime_le
            ? `Commentaire supprimé le ${formaterDateHeure(c.supprime_le)}.`
            : "Commentaire supprimé."}
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
              aria-label={`Modifier votre commentaire du ${formaterDateHeure(c.cree_le)}`}
            >
              Modifier
            </Bouton>
          ) : null}
          {a.supprimer ? (
            <BoutonConfirmation
              libelle="Supprimer"
              variante="discret"
              icone="corbeille"
              ariaLabel={`Supprimer le commentaire de ${c.auteur_nom} du ${formaterDateHeure(c.cree_le)}`}
              question="Supprimer ce commentaire ? Le fil gardera la trace de sa suppression."
              libelleConfirmation="Oui, supprimer"
              texteChargement="Suppression…"
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
      setEtat({ phase: "erreur", message: messageCommentaire(e) });
    }
  }

  return (
    <details
      className="mp-details mp-commentaire__historique"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) void ouvrir();
      }}
    >
      <summary>Historique des modifications</summary>
      {etat.phase === "chargement" ? (
        <Squelette lignes={2} libelle="Chargement de l'historique…" />
      ) : etat.phase === "erreur" ? (
        <p className="mp-champ__erreur" role="alert">
          {etat.message}
        </p>
      ) : etat.phase === "pret" ? (
        <ol className="mp-commentaire__versions">
          {etat.versions.map((v, i) => (
            <li key={`${v.cree_le}-${i}`}>
              <span className="mp-texte-doux mp-texte-petit">
                {i === 0 ? "Texte initial, " : `Modification ${i}, `}
                <time dateTime={v.cree_le}>{formaterDateHeure(v.cree_le)}</time>
              </span>
              <p className="mp-commentaire__texte">{v.texte}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </details>
  );
}
