"use client";

import { useState } from "react";
import { FichierJoint } from "../../../../../components/fichiers/FichierJoint";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../../../../../components/formulaires/useAttenteRafraichissement";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Bouton } from "../../../../../components/ui/Bouton";
import { EtatVide } from "../../../../../components/ui/EtatListe";
import { Icone } from "../../../../../components/ui/Icone";
import { Squelette } from "../../../../../components/ui/Squelette";
import { api, messageErreur } from "../../../../../lib/api";
import {
  actionsDocument,
  grouperParType,
  messageDocument,
  STATUT_CONTENU,
  typesDeposables,
  type ContexteDocuments,
  type DetailDocument,
  type VersionDocument,
} from "../../../../../lib/documents";
import { formaterDateHeure } from "../../../../../lib/format";
import { TYPE_DOCUMENT_LIBELLES } from "../../../../../lib/missions";
import { DepotDocument } from "./DepotDocument";

export interface DocumentsMissionProps {
  missionId: string;
  documents: VersionDocument[];
  contexte: ContexteDocuments;
}

/**
 * Onglet Documents de la mission (SOC-05, SOC-06) : version courante de chaque document par
 * type, dépôt d'un document ou d'une nouvelle version, statut du contenu (brouillon IA,
 * modifié, validé : texte + icône), validation par un responsable, historique des versions.
 */
export function DocumentsMission({ missionId, documents, contexte }: DocumentsMissionProps) {
  const types = typesDeposables(contexte);
  const [depot, setDepot] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const groupes = grouperParType(documents);

  return (
    <div className="mp-pile mp-pile--large">
      <div className="mp-entete-section">
        <p className="mp-texte-doux">
          {contexte.missionCloturee
            ? "Mission clôturée : les documents restent consultables, plus aucun dépôt n'est possible."
            : "Propositions, lettre de mission, livrables : chaque nouveau dépôt de même type et de même nom crée une version, sans effacer les précédentes."}
        </p>
        {types.length > 0 && !depot ? (
          <div>
            <Bouton
              icone="plus"
              onClick={() => {
                setMessage(null);
                setDepot(true);
              }}
            >
              Déposer un document
            </Bouton>
          </div>
        ) : null}
      </div>
      {message ? (
        <Alerte tonalite="succes" annonce="status">
          <p>{message}</p>
        </Alerte>
      ) : null}
      {depot ? (
        <DepotDocument
          missionId={missionId}
          typesPermis={types}
          existants={documents}
          onFin={() => setDepot(false)}
          onDepose={(m) => {
            setMessage(m);
            setDepot(false);
          }}
        />
      ) : null}
      {groupes.length === 0 ? (
        <EtatVide titre="Aucun document." icone="dossier">
          <p>La lettre de mission est enregistrée automatiquement à la signature.</p>
        </EtatVide>
      ) : (
        groupes.map((g) => (
          <section key={g.type} className="mp-pile" aria-labelledby={`documents-${g.type}`}>
            <h2 id={`documents-${g.type}`} className="mp-section__titre">
              {`${TYPE_DOCUMENT_LIBELLES[g.type]} (${g.documents.length})`}
            </h2>
            <ul className="mp-liste-lignes" aria-label={TYPE_DOCUMENT_LIBELLES[g.type]}>
              {g.documents.map((d) => (
                <LigneDocument
                  key={d.id}
                  d={d}
                  missionId={missionId}
                  contexte={contexte}
                  types={types}
                  existants={documents}
                  onMessage={setMessage}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function BadgeContenu({ statut }: { statut: VersionDocument["statut_contenu"] }) {
  if (!statut) return null;
  const s = STATUT_CONTENU[statut];
  // Texte + icône propre au statut (la couleur ne porte jamais seule le sens).
  return (
    <span className={`mp-badge mp-badge--${s.tonalite}`}>
      <Icone nom={s.icone} taille={14} />
      <span>{s.libelle}</span>
    </span>
  );
}

function SourceDocument({ d }: { d: VersionDocument }) {
  if (d.fichier) {
    return <FichierJoint fichier={d.fichier} contexte={`(version ${d.version} de ${d.nom})`} />;
  }
  if (d.chemin_stockage) {
    return (
      <span className="mp-texte-petit mp-coupure">{`Référence (sans fichier) : ${d.chemin_stockage}`}</span>
    );
  }
  return <span className="mp-texte-petit mp-texte-doux">Aucun fichier rattaché.</span>;
}

function LigneDocument({
  d,
  missionId,
  contexte,
  types,
  existants,
  onMessage,
}: {
  d: VersionDocument;
  missionId: string;
  contexte: ContexteDocuments;
  types: VersionDocument["type"][];
  existants: readonly VersionDocument[];
  onMessage: (m: string) => void;
}) {
  const [version, setVersion] = useState(false);
  const f = useFormulaire<never>();
  const [attente, marquer] = useAttenteRafraichissement(`${d.id}-${d.statut_contenu}`);
  const a = actionsDocument(d, contexte);
  const changerStatut = (statut: "modifie" | "valide") =>
    f.envoyer(
      { ok: true, charge: { statut } },
      (c) => api.post(`/api/documents/${encodeURIComponent(d.id)}/statut`, c),
      {
        succes: statut === "valide" ? `« ${d.nom} » validé.` : `« ${d.nom} » marqué comme modifié.`,
        messageSpecifique: messageDocument,
        apres: marquer,
      },
    );

  return (
    <li className="mp-liste-lignes__ligne mp-document">
      <span className="mp-liste-lignes__texte">
        <span className="mp-document__titre">
          <strong className="mp-coupure">{d.nom}</strong>
          <BadgeStatut tonalite="neutre" sansIcone>{`v${d.version}`}</BadgeStatut>
          <BadgeContenu statut={d.statut_contenu} />
        </span>
        <span className="mp-texte-doux mp-texte-petit">
          {`Déposé par ${d.auteur_nom ?? "—"} le ${formaterDateHeure(d.cree_le)}`}
          {d.statut_contenu === "valide" && d.valide_le
            ? ` · validé le ${formaterDateHeure(d.valide_le)}`
            : ""}
        </span>
        {d.statut_contenu ? (
          <span className="mp-texte-petit">{STATUT_CONTENU[d.statut_contenu].aide}</span>
        ) : null}
        <SourceDocument d={d} />
      </span>
      <div className="mp-barre-actions mp-barre-actions--compacte">
        {a.nouvelleVersion && !version ? (
          <Bouton
            variante="secondaire"
            icone="plus"
            onClick={() => setVersion(true)}
            aria-label={`Déposer une nouvelle version de ${d.nom}`}
          >
            Nouvelle version
          </Bouton>
        ) : null}
        {a.marquerModifie ? (
          <Bouton
            variante="discret"
            icone="crayon"
            chargement={f.enCours || attente}
            texteChargement="En cours…"
            onClick={() => void changerStatut("modifie")}
            aria-label={`Marquer ${d.nom} comme relu et modifié`}
          >
            Marquer comme modifié
          </Bouton>
        ) : null}
        {a.valider ? (
          <Bouton
            icone="succes"
            chargement={f.enCours || attente}
            texteChargement="Validation…"
            onClick={() => void changerStatut("valide")}
            aria-label={`Valider le contenu de ${d.nom}`}
          >
            Valider
          </Bouton>
        ) : null}
      </div>
      {a.raisonSansValidation ? (
        <p className="mp-indice mp-texte-doux mp-texte-petit mp-pleine-largeur">
          <Icone nom="info" taille={16} />
          <span>{a.raisonSansValidation}</span>
        </p>
      ) : null}
      <div className="mp-pleine-largeur">
        <RetourFormulaire
          erreur={f.erreurGlobale}
          succes={f.succes}
          refAlerte={f.refAlerte}
          titreErreur="Action impossible"
        />
      </div>
      {version ? (
        <div className="mp-pleine-largeur">
          <DepotDocument
            missionId={missionId}
            typesPermis={types}
            existants={existants}
            version={d}
            onFin={() => setVersion(false)}
            onDepose={(m) => {
              setVersion(false);
              onMessage(m);
            }}
          />
        </div>
      ) : null}
      {d.version > 1 || d.statut_contenu ? (
        <div className="mp-pleine-largeur">
          <HistoriqueDocument id={d.id} nom={d.nom} />
        </div>
      ) : null}
    </li>
  );
}

const LIBELLE_ETAPE: Record<string, string> = {
  brouillon_ia: "Brouillon IA déposé",
  modifie: "Marqué comme modifié",
  valide: "Validé",
};

/** Versions et historique du statut, chargés à l'ouverture (connexion épargnée). */
function HistoriqueDocument({ id, nom }: { id: string; nom: string }) {
  const [etat, setEtat] = useState<
    | { phase: "ferme" }
    | { phase: "chargement" }
    | { phase: "erreur"; message: string }
    | { phase: "pret"; detail: DetailDocument }
  >({ phase: "ferme" });

  async function ouvrir() {
    if (etat.phase === "chargement" || etat.phase === "pret") return;
    setEtat({ phase: "chargement" });
    try {
      setEtat({
        phase: "pret",
        detail: await api.get<DetailDocument>(`/api/documents/${encodeURIComponent(id)}`),
      });
    } catch (e) {
      setEtat({ phase: "erreur", message: messageErreur(e) });
    }
  }

  return (
    <details
      className="mp-details"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) void ouvrir();
      }}
    >
      <summary>
        Historique
        <span className="mp-visuellement-cache">{` de ${nom}`}</span>
      </summary>
      {etat.phase === "chargement" ? (
        <Squelette lignes={3} libelle="Chargement de l'historique…" />
      ) : etat.phase === "erreur" ? (
        <div className="mp-pile">
          <p className="mp-champ__erreur" role="alert">
            {etat.message}
          </p>
          <div>
            <Bouton
              variante="secondaire"
              onClick={() => {
                setEtat({ phase: "ferme" });
                void ouvrir();
              }}
            >
              Réessayer
            </Bouton>
          </div>
        </div>
      ) : etat.phase === "pret" ? (
        <div className="mp-pile">
          <h3 className="mp-texte-petit mp-document__sous-titre">Versions</h3>
          <ol className="mp-document__versions">
            {etat.detail.versions.map((v) => (
              <li key={v.id}>
                <span className="mp-document__titre">
                  <strong>{`Version ${v.version}`}</strong>
                  {v.est_version_courante ? (
                    <BadgeStatut tonalite="succes" sansIcone>
                      Courante
                    </BadgeStatut>
                  ) : null}
                  <BadgeContenu statut={v.statut_contenu} />
                </span>
                <span className="mp-texte-doux mp-texte-petit">
                  {`${v.auteur_nom ?? "—"}, le ${formaterDateHeure(v.cree_le)}`}
                </span>
                <SourceDocument d={v} />
              </li>
            ))}
          </ol>
          {etat.detail.historique_statut.length > 0 ? (
            <>
              <h3 className="mp-texte-petit mp-document__sous-titre">
                Statut du contenu (version courante)
              </h3>
              <ol className="mp-document__versions">
                {etat.detail.historique_statut.map((s, i) => (
                  <li key={`${s.cree_le}-${i}`}>
                    <span>{LIBELLE_ETAPE[s.statut] ?? s.statut}</span>
                    <span className="mp-texte-doux mp-texte-petit">
                      {`${s.par_nom ?? "—"}, le ${formaterDateHeure(s.cree_le)}`}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
