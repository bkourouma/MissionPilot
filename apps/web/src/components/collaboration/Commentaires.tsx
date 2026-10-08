"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { TypeEntiteCollaboration } from "@missionpilot/shared";
import { api, messageErreur } from "../../lib/api";
import {
  actionsCommentaire,
  fusionnerCommentaires,
  libelleDelaiModification,
  mentionsDuTexte,
  messageCommentaire,
  requeteCommentaires,
  secondesRestantes,
  segmentsCommentaire,
  validerTexteCommentaire,
  type Commentaire,
  type Mentionnable,
  type PageCommentaires,
} from "../../lib/commentaires";
import { formaterDateHeure } from "../../lib/format";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { EtatVide } from "../ui/EtatListe";
import { Icone } from "../ui/Icone";
import { Squelette } from "../ui/Squelette";
import { ZoneTexte } from "../ui/ZoneTexte";
import { SaisieMentions } from "./SaisieMentions";

export interface CommentairesProps {
  entiteType: TypeEntiteCollaboration;
  entiteId: string;
  utilisateurId: string;
  /** Un associé peut supprimer le commentaire d'autrui. */
  associe: boolean;
  /** Niveau du titre « Commentaires » (aucun titre si `null`). */
  niveauTitre?: 2 | 3 | 4 | null;
  /** Nom de l'élément commenté pour les noms accessibles (ex. « la facture F-2026-0012 »). */
  nomElement?: string;
}

type Etat =
  | { phase: "chargement" }
  | { phase: "erreur"; message: string }
  | { phase: "pret"; elements: Commentaire[]; curseur: string | null };

/** Rafraîchissement du compte à rebours de modification. */
const TIC_MS = 15_000;

/**
 * Fil de commentaires d'un élément (SOC-08) : liste paginée (du plus ancien au plus récent),
 * saisie avec mentions « @ », modification par l'auteur dans les 15 minutes (compte à rebours
 * discret), historique des modifications, suppression logique confirmée en deux temps. Le
 * texte est rendu comme du texte brut (React l'échappe ; aucun HTML interprété), retours à la
 * ligne conservés par CSS.
 */
export function Commentaires({
  entiteType,
  entiteId,
  utilisateurId,
  associe,
  niveauTitre = 2,
  nomElement,
}: CommentairesProps) {
  const [etat, setEtat] = useState<Etat>({ phase: "chargement" });
  const [suite, setSuite] = useState<{ enCours: boolean; erreur: string | null }>({
    enCours: false,
    erreur: null,
  });
  const [maintenant, setMaintenant] = useState(() => Date.now());

  const charger = useCallback(
    async (signal?: AbortSignal) => {
      setEtat({ phase: "chargement" });
      try {
        const r = await api.get<PageCommentaires>(requeteCommentaires(entiteType, entiteId), {
          signal,
        });
        setMaintenant(Date.now());
        setEtat({ phase: "pret", elements: r.elements, curseur: r.curseur_suivant });
      } catch (e) {
        if (signal?.aborted) return;
        setEtat({ phase: "erreur", message: messageErreur(e) });
      }
    },
    [entiteType, entiteId],
  );

  useEffect(() => {
    const controle = new AbortController();
    void charger(controle.signal);
    return () => controle.abort();
  }, [charger]);

  // Compte à rebours : seulement tant qu'un de ses commentaires est encore modifiable.
  const fenetreOuverte =
    etat.phase === "pret" &&
    etat.elements.some(
      (c) =>
        c.auteur_id === utilisateurId &&
        !c.supprime &&
        secondesRestantes(c.modifiable_jusqu_au, maintenant) > 0,
    );
  useEffect(() => {
    if (!fenetreOuverte) return;
    const t = setInterval(() => setMaintenant(Date.now()), TIC_MS);
    return () => clearInterval(t);
  }, [fenetreOuverte]);

  const integrer = (nouveaux: Commentaire[], curseur?: string | null) =>
    setEtat((e) =>
      e.phase === "pret"
        ? {
            phase: "pret",
            elements: fusionnerCommentaires(e.elements, nouveaux),
            curseur: curseur === undefined ? e.curseur : curseur,
          }
        : e,
    );

  async function chargerSuite() {
    if (etat.phase !== "pret" || !etat.curseur) return;
    setSuite({ enCours: true, erreur: null });
    try {
      const r = await api.get<PageCommentaires>(
        requeteCommentaires(entiteType, entiteId, etat.curseur),
      );
      integrer(r.elements, r.curseur_suivant);
      setSuite({ enCours: false, erreur: null });
    } catch (e) {
      setSuite({ enCours: false, erreur: messageErreur(e) });
    }
  }

  const Titre = niveauTitre ? (`h${niveauTitre}` as const) : null;
  const nombre = etat.phase === "pret" ? etat.elements.length : null;
  return (
    <section className="mp-commentaires" aria-label={Titre ? undefined : "Commentaires"}>
      {Titre ? (
        <Titre className="mp-commentaires__titre">
          <Icone nom="bulle" />
          <span>Commentaires</span>
          {nombre ? (
            <span className="mp-texte-doux">{` (${nombre}${etat.phase === "pret" && etat.curseur ? "+" : ""})`}</span>
          ) : null}
        </Titre>
      ) : null}
      {etat.phase === "chargement" ? (
        <Squelette lignes={2} libelle="Chargement des commentaires…" />
      ) : etat.phase === "erreur" ? (
        <div className="mp-pile">
          <Alerte tonalite="danger" titre="Les commentaires n'ont pas pu être chargés.">
            <p>{etat.message}</p>
          </Alerte>
          <div>
            <Bouton variante="secondaire" onClick={() => void charger()}>
              Réessayer
            </Bouton>
          </div>
        </div>
      ) : (
        <>
          {etat.elements.length === 0 ? (
            <EtatVide titre="Aucun commentaire pour l'instant." icone="bulle">
              <p>
                Posez une question ou laissez une précision à l&apos;équipe ; mentionnez un collègue
                avec « @ ».
              </p>
            </EtatVide>
          ) : (
            <ol className="mp-commentaires__liste">
              {etat.elements.map((c) => (
                <ElementCommentaire
                  key={c.id}
                  c={c}
                  utilisateurId={utilisateurId}
                  associe={associe}
                  maintenant={maintenant}
                  onMaj={(x) => integrer([x])}
                />
              ))}
            </ol>
          )}
          {etat.curseur ? (
            <div className="mp-pile">
              {suite.erreur ? (
                <p className="mp-champ__erreur" role="alert">
                  {suite.erreur}
                </p>
              ) : null}
              <div>
                <Bouton
                  variante="secondaire"
                  chargement={suite.enCours}
                  texteChargement="Chargement…"
                  onClick={() => void chargerSuite()}
                >
                  Afficher les commentaires suivants
                </Bouton>
              </div>
            </div>
          ) : null}
          <NouveauCommentaire
            entiteType={entiteType}
            entiteId={entiteId}
            nomElement={nomElement}
            onPublie={(c) => {
              setMaintenant(Date.now());
              integrer([c]);
            }}
          />
        </>
      )}
    </section>
  );
}

function NouveauCommentaire({
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

function ElementCommentaire({
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

function EditionCommentaire({
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

/**
 * Commentaires repliés (listes : débours, tâches du découpage) : le fil n'est chargé qu'à
 * l'ouverture, pour épargner la connexion.
 */
export function CommentairesRepliables(props: Omit<CommentairesProps, "niveauTitre">) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <details
      className="mp-details mp-commentaires-repliables"
      onToggle={(e) => setOuvert((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <Icone nom="bulle" taille={18} />
        <span>
          Commentaires
          {props.nomElement ? (
            <span className="mp-visuellement-cache">{` sur ${props.nomElement}`}</span>
          ) : null}
        </span>
      </summary>
      {ouvert ? <Commentaires {...props} niveauTitre={null} /> : null}
    </details>
  );
}
