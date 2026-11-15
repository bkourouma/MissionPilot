"use client";

import { useState, type FormEvent } from "react";
import type { TypeEntiteCollaboration } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  mentionsDuTexte,
  messageCommentaire,
  validerTexteCommentaire,
  type Commentaire,
  type Mentionnable,
} from "../../lib/commentaires";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { ZoneTexte } from "../ui/ZoneTexte";
import { SaisieMentions } from "./SaisieMentions";

export function NouveauCommentaire({
  entiteType,
  entiteId,
  nomElement,
  onPublie,
}: {
  entiteType: TypeEntiteCollaboration;
  entiteId: string;
  nomElement?: string;
  onPublie: (c: Commentaire) => void;
}) {
  const t = useT();
  const langue = useLangue();
  const [texte, setTexte] = useState("");
  const [choisies, setChoisies] = useState<Mentionnable[]>([]);
  const [erreur, setErreur] = useState<string | undefined>();
  const [erreurEnvoi, setErreurEnvoi] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [annonce, setAnnonce] = useState("");

  async function publier(ev?: FormEvent<HTMLFormElement>) {
    ev?.preventDefault();
    if (enCours) return;
    setErreurEnvoi(null);
    const v = validerTexteCommentaire(texte, langue);
    if (!v.ok) {
      setErreur(v.erreurs.texte);
      return;
    }
    setErreur(undefined);
    setEnCours(true);
    try {
      const c = await api.post<Commentaire>("/api/commentaires", {
        entite_type: entiteType,
        entite_id: entiteId,
        texte: v.charge,
        mentions: mentionsDuTexte(v.charge, choisies),
      });
      onPublie(c);
      setTexte("");
      setChoisies([]);
      setAnnonce(t("Commentaire publié.", "Comment published."));
    } catch (e) {
      // Le texte reste dans la zone : rien n'est perdu après une coupure.
      setErreurEnvoi(messageCommentaire(e, langue));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form
      className="mp-formulaire mp-commentaires__saisie"
      noValidate
      onSubmit={publier}
      aria-label={
        nomElement
          ? t(`Commenter ${nomElement}`, `Comment on ${nomElement}`)
          : t("Nouveau commentaire", "New comment")
      }
    >
      {erreurEnvoi ? (
        <Alerte tonalite="danger" titre={t("Commentaire non publié", "Comment not published")}>
          <p>
            {erreurEnvoi} {t("Votre texte est conservé.", "Your text is kept.")}
          </p>
        </Alerte>
      ) : null}
      <SaisieMentions
        libelle={t("Votre commentaire", "Your comment")}
        aide={t(
          "Texte simple. « @ » suivi d'un nom pour mentionner un collègue (il sera notifié). Ctrl+Entrée pour publier.",
          'Plain text. "@" followed by a name to mention a colleague (they will be notified). Ctrl+Enter to publish.',
        )}
        valeur={texte}
        onChange={setTexte}
        onMention={(m) => setChoisies((l) => (l.some((x) => x.id === m.id) ? l : [...l, m]))}
        entiteType={entiteType}
        entiteId={entiteId}
        erreur={erreur}
        onValider={() => void publier()}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone="envoyer"
          chargement={enCours}
          texteChargement={t("Publication…", "Publishing…")}
        >
          {t("Publier", "Publish")}
        </Bouton>
      </div>
      <span className="mp-visuellement-cache" role="status">
        {annonce}
      </span>
    </form>
  );
}

export function EditionCommentaire({
  c,
  onFin,
}: {
  c: Commentaire;
  onFin: (c: Commentaire | null) => void;
}) {
  const t = useT();
  const langue = useLangue();
  const [texte, setTexte] = useState(c.texte ?? "");
  const [erreur, setErreur] = useState<string | undefined>();
  const [erreurEnvoi, setErreurEnvoi] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function enregistrer(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setErreurEnvoi(null);
    const v = validerTexteCommentaire(texte, langue);
    if (!v.ok) return setErreur(v.erreurs.texte);
    setErreur(undefined);
    if (v.charge === (c.texte ?? "").trim()) return onFin(null);
    setEnCours(true);
    try {
      onFin(
        await api.patch<Commentaire>(`/api/commentaires/${encodeURIComponent(c.id)}`, {
          texte: v.charge,
        }),
      );
    } catch (e) {
      setErreurEnvoi(messageCommentaire(e, langue));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form
      className="mp-formulaire"
      noValidate
      onSubmit={enregistrer}
      aria-label={t("Modifier le commentaire", "Edit the comment")}
    >
      {erreurEnvoi ? (
        <Alerte tonalite="danger" titre={t("Modification impossible", "Could not edit")}>
          <p>{erreurEnvoi}</p>
        </Alerte>
      ) : null}
      <ZoneTexte
        libelle={t("Texte du commentaire", "Comment text")}
        maxLength={5000}
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        erreur={erreur}
        autoFocus
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer", "Save")}
        </Bouton>
        <Bouton variante="discret" onClick={() => onFin(null)} disabled={enCours}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}
