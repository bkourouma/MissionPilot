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
    const v = validerTexteCommentaire(texte);
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
      setAnnonce("Commentaire publié.");
    } catch (e) {
      // Le texte reste dans la zone : rien n'est perdu après une coupure.
      setErreurEnvoi(messageCommentaire(e));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form
      className="mp-formulaire mp-commentaires__saisie"
      noValidate
      onSubmit={publier}
      aria-label={nomElement ? `Commenter ${nomElement}` : "Nouveau commentaire"}
    >
      {erreurEnvoi ? (
        <Alerte tonalite="danger" titre="Commentaire non publié">
          <p>{erreurEnvoi} Votre texte est conservé.</p>
        </Alerte>
      ) : null}
      <SaisieMentions
        libelle="Votre commentaire"
        aide="Texte simple. « @ » suivi d'un nom pour mentionner un collègue (il sera notifié). Ctrl+Entrée pour publier."
        valeur={texte}
        onChange={setTexte}
        onMention={(m) => setChoisies((l) => (l.some((x) => x.id === m.id) ? l : [...l, m]))}
        entiteType={entiteType}
        entiteId={entiteId}
        erreur={erreur}
        onValider={() => void publier()}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" icone="envoyer" chargement={enCours} texteChargement="Publication…">
          Publier
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
  const [texte, setTexte] = useState(c.texte ?? "");
  const [erreur, setErreur] = useState<string | undefined>();
  const [erreurEnvoi, setErreurEnvoi] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function enregistrer(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setErreurEnvoi(null);
    const v = validerTexteCommentaire(texte);
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
      setErreurEnvoi(messageCommentaire(e));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form
      className="mp-formulaire"
      noValidate
      onSubmit={enregistrer}
      aria-label="Modifier le commentaire"
    >
      {erreurEnvoi ? (
        <Alerte tonalite="danger" titre="Modification impossible">
          <p>{erreurEnvoi}</p>
        </Alerte>
      ) : null}
      <ZoneTexte
        libelle="Texte du commentaire"
        maxLength={5000}
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        erreur={erreur}
        autoFocus
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={enCours} texteChargement="Enregistrement…">
          Enregistrer
        </Bouton>
        <Bouton variante="discret" onClick={() => onFin(null)} disabled={enCours}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
