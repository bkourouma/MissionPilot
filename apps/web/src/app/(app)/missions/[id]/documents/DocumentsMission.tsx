"use client";

import { useState } from "react";
import { FichierJoint } from "../../../../../components/fichiers/FichierJoint";
import { useLangue, useT } from "../../../../../components/i18n/FournisseurLangue";
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
  statutContenu,
  typesDeposables,
  type ContexteDocuments,
  type DetailDocument,
  type VersionDocument,
} from "../../../../../lib/documents";
import { formaterDateHeure } from "../../../../../lib/format";
import { libelleTypeDocument } from "../../../../../lib/missions";
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
  const t = useT();
  const langue = useLangue();
  const types = typesDeposables(contexte);
  const [depot, setDepot] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const groupes = grouperParType(documents);

  return (
    <div className="mp-pile mp-pile--large">
      <div className="mp-entete-section">
        <p className="mp-texte-doux">
          {contexte.missionCloturee
            ? t(
                "Mission clôturée : les documents restent consultables, plus aucun dépôt n'est possible.",
                "Engagement closed: documents remain viewable, no further uploads are possible.",
              )
            : t(
                "Propositions, lettre de mission, livrables : chaque nouveau dépôt de même type et de même nom crée une version, sans effacer les précédentes.",
                "Proposals, engagement letter, deliverables: each new upload of the same type and name creates a version, without erasing the previous ones.",
              )}
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
              {t("Déposer un document", "Upload a document")}
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
        <EtatVide titre={t("Aucun document.", "No documents.")} icone="dossier">
          <p>
            {t(
              "La lettre de mission est enregistrée automatiquement à la signature.",
              "The engagement letter is saved automatically when signed.",
            )}
          </p>
        </EtatVide>
      ) : (
        groupes.map((g) => (
          <section key={g.type} className="mp-pile" aria-labelledby={`documents-${g.type}`}>
            <h2 id={`documents-${g.type}`} className="mp-section__titre">
              {`${libelleTypeDocument(g.type, langue)} (${g.documents.length})`}
            </h2>
            <ul className="mp-liste-lignes" aria-label={libelleTypeDocument(g.type, langue)}>
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
  const langue = useLangue();
  if (!statut) return null;
  const s = statutContenu(statut, langue);
  // Texte + icône propre au statut (la couleur ne porte jamais seule le sens).
  return (
    <span className={`mp-badge mp-badge--${s.tonalite}`}>
      <Icone nom={s.icone} taille={14} />
      <span>{s.libelle}</span>
    </span>
  );
}

function SourceDocument({ d }: { d: VersionDocument }) {
  const t = useT();
  if (d.fichier) {
    return (
      <FichierJoint
        fichier={d.fichier}
        contexte={t(`(version ${d.version} de ${d.nom})`, `(version ${d.version} of ${d.nom})`)}
      />
    );
  }
  if (d.chemin_stockage) {
    return (
      <span className="mp-texte-petit mp-coupure">{`${t("Référence (sans fichier) :", "Reference (no file):")} ${d.chemin_stockage}`}</span>
    );
  }
  return (
    <span className="mp-texte-petit mp-texte-doux">
      {t("Aucun fichier rattaché.", "No file attached.")}
    </span>
  );
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
  const t = useT();
  const langue = useLangue();
  const [version, setVersion] = useState(false);
  const f = useFormulaire<never>();
  const [attente, marquer] = useAttenteRafraichissement(`${d.id}-${d.statut_contenu}`);
  const a = actionsDocument(d, contexte, langue);
  const changerStatut = (statut: "modifie" | "valide") =>
    f.envoyer(
      { ok: true, charge: { statut } },
      (c) => api.post(`/api/documents/${encodeURIComponent(d.id)}/statut`, c),
      {
        succes:
          statut === "valide"
            ? t(`« ${d.nom} » validé.`, `"${d.nom}" approved.`)
            : t(`« ${d.nom} » marqué comme modifié.`, `"${d.nom}" marked as edited.`),
        messageSpecifique: (e) => messageDocument(e, langue),
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
          {t(
            `Déposé par ${d.auteur_nom ?? "—"} le ${formaterDateHeure(d.cree_le)}`,
            `Uploaded by ${d.auteur_nom ?? "—"} on ${formaterDateHeure(d.cree_le, undefined, "en")}`,
          )}
          {d.statut_contenu === "valide" && d.valide_le
            ? t(
                ` · validé le ${formaterDateHeure(d.valide_le)}`,
                ` · approved on ${formaterDateHeure(d.valide_le, undefined, "en")}`,
              )
            : ""}
        </span>
        {d.statut_contenu ? (
          <span className="mp-texte-petit">{statutContenu(d.statut_contenu, langue).aide}</span>
        ) : null}
        <SourceDocument d={d} />
      </span>
      <div className="mp-barre-actions mp-barre-actions--compacte">
        {a.nouvelleVersion && !version ? (
          <Bouton
            variante="secondaire"
            icone="plus"
            onClick={() => setVersion(true)}
            aria-label={t(
              `Déposer une nouvelle version de ${d.nom}`,
              `Upload a new version of ${d.nom}`,
            )}
          >
            {t("Nouvelle version", "New version")}
          </Bouton>
        ) : null}
        {a.marquerModifie ? (
          <Bouton
            variante="discret"
            icone="crayon"
            chargement={f.enCours || attente}
            texteChargement={t("En cours…", "In progress…")}
            onClick={() => void changerStatut("modifie")}
            aria-label={t(
              `Marquer ${d.nom} comme relu et modifié`,
              `Mark ${d.nom} as reviewed and edited`,
            )}
          >
            {t("Marquer comme modifié", "Mark as edited")}
          </Bouton>
        ) : null}
        {a.valider ? (
          <Bouton
            icone="succes"
            chargement={f.enCours || attente}
            texteChargement={t("Validation…", "Approving…")}
            onClick={() => void changerStatut("valide")}
            aria-label={t(`Valider le contenu de ${d.nom}`, `Approve the content of ${d.nom}`)}
          >
            {t("Valider", "Approve")}
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
          titreErreur={t("Action impossible", "Action not possible")}
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
const LIBELLE_ETAPE_EN: Record<string, string> = {
  brouillon_ia: "AI draft uploaded",
  modifie: "Marked as edited",
  valide: "Approved",
};

/** Versions et historique du statut, chargés à l'ouverture (connexion épargnée). */
function HistoriqueDocument({ id, nom }: { id: string; nom: string }) {
  const t = useT();
  const langue = useLangue();
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
        {t("Historique", "History")}
        <span className="mp-visuellement-cache">{t(` de ${nom}`, ` of ${nom}`)}</span>
      </summary>
      {etat.phase === "chargement" ? (
        <Squelette lignes={3} libelle={t("Chargement de l'historique…", "Loading history…")} />
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
              {t("Réessayer", "Try again")}
            </Bouton>
          </div>
        </div>
      ) : etat.phase === "pret" ? (
        <div className="mp-pile">
          <h3 className="mp-texte-petit mp-document__sous-titre">{t("Versions", "Versions")}</h3>
          <ol className="mp-document__versions">
            {etat.detail.versions.map((v) => (
              <li key={v.id}>
                <span className="mp-document__titre">
                  <strong>{`${t("Version", "Version")} ${v.version}`}</strong>
                  {v.est_version_courante ? (
                    <BadgeStatut tonalite="succes" sansIcone>
                      {t("Courante", "Current")}
                    </BadgeStatut>
                  ) : null}
                  <BadgeContenu statut={v.statut_contenu} />
                </span>
                <span className="mp-texte-doux mp-texte-petit">
                  {`${v.auteur_nom ?? "—"}, ${t("le", "on")} ${formaterDateHeure(v.cree_le, undefined, langue)}`}
                </span>
                <SourceDocument d={v} />
              </li>
            ))}
          </ol>
          {etat.detail.historique_statut.length > 0 ? (
            <>
              <h3 className="mp-texte-petit mp-document__sous-titre">
                {t("Statut du contenu (version courante)", "Content status (current version)")}
              </h3>
              <ol className="mp-document__versions">
                {etat.detail.historique_statut.map((s, i) => (
                  <li key={`${s.cree_le}-${i}`}>
                    <span>
                      {(langue === "en" ? LIBELLE_ETAPE_EN : LIBELLE_ETAPE)[s.statut] ?? s.statut}
                    </span>
                    <span className="mp-texte-doux mp-texte-petit">
                      {`${s.par_nom ?? "—"}, ${t("le", "on")} ${formaterDateHeure(s.cree_le, undefined, langue)}`}
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
