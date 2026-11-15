"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { api } from "../../lib/api";
import { messageSpecifiqueLangue } from "../../lib/double-authentification";
import { libelleStatutMission, libelleTypeDocument, STATUT_MISSION } from "../../lib/missions";
import {
  basculerDocument,
  basculerMission,
  basculerOption,
  brouillonDepuisPartages,
  brouillonModifie,
  chargePartages,
  cheminPartagesPortail,
  detailMissionPartagee,
  messageErreurPortailGestion,
  phraseResume,
  resumePartages,
  type BrouillonPartages,
  type LigneDocumentPartage,
  type MissionPartageable,
  type PartagesClient,
} from "../../lib/portail-gestion";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { Carte } from "../ui/Carte";
import { CaseACocher } from "../ui/CaseACocher";
import { EtatVide } from "../ui/EtatListe";
import { Select, type OptionSelect } from "../ui/Select";
import type { Langue, Traduire } from "@missionpilot/shared";
import "./portail-gestion.css";

/** Ancre du formulaire des partages (lien depuis le résumé). */
export const ID_FORMULAIRE_PARTAGES = "partages-client";

interface EtatPartages {
  /** Partages enregistrés (réponse de l'API) : source du résumé. */
  enregistre: PartagesClient;
  initial: BrouillonPartages;
  brouillon: BrouillonPartages;
  modifie: boolean;
  setBrouillon: (b: BrouillonPartages) => void;
  enregistrer: (r: PartagesClient) => void;
}

const ContextePartages = createContext<EtatPartages | null>(null);

function usePartages(): EtatPartages {
  const c = useContext(ContextePartages);
  if (!c) throw new Error("FournisseurPartages manquant.");
  return c;
}

/**
 * État partagé entre le résumé (en tête de page) et le formulaire (plus bas). Il part des
 * données du serveur au premier affichage, puis suit les réponses de l'API : un
 * rafraîchissement de la page (après une invitation, par exemple) n'efface pas un brouillon.
 */
export function FournisseurPartages({
  partages,
  children,
}: {
  partages: PartagesClient;
  children: ReactNode;
}) {
  const [enregistre, setEnregistre] = useState(partages);
  const initial = useMemo(() => brouillonDepuisPartages(enregistre), [enregistre]);
  const [brouillon, setBrouillon] = useState(initial);
  const valeur = useMemo<EtatPartages>(
    () => ({
      enregistre,
      initial,
      brouillon,
      modifie: brouillonModifie(brouillon, initial),
      setBrouillon,
      enregistrer: (r) => {
        setEnregistre(r);
        setBrouillon(brouillonDepuisPartages(r));
      },
    }),
    [enregistre, initial, brouillon],
  );
  return <ContextePartages.Provider value={valeur}>{children}</ContextePartages.Provider>;
}

// --- Résumé ----------------------------------------------------------------------------------

/** « Ce que voit votre client » : état ENREGISTRÉ, rien par défaut. */
export function ResumePartages({ voitToutesLesMissions }: { voitToutesLesMissions: boolean }) {
  const t = useT();
  const langue = useLangue();
  const { enregistre, modifie } = usePartages();
  const r = resumePartages(enregistre);
  return (
    <Carte titre={t("Ce que voit votre client", "What your client sees")}>
      <div className="mp-pile">
        {r.rien ? (
          <Alerte
            tonalite="info"
            annonce="aucune"
            titre={t(
              "Votre client ne voit encore aucune mission.",
              "Your client does not see any engagement yet.",
            )}
          >
            <p>
              {t(
                "Rien n'est partagé par défaut. Cochez plus bas les missions, jalons, factures et documents à lui montrer, puis enregistrez.",
                "Nothing is shared by default. Check below the engagements, milestones, invoices and documents to show them, then save.",
              )}
            </p>
          </Alerte>
        ) : (
          <ul
            className="mp-resume-portail"
            aria-label={t(
              "Missions partagées avec le client",
              "Engagements shared with the client",
            )}
          >
            {r.missions.map((m) => (
              <li key={m.id} className="mp-resume-portail__element">
                <strong className="mp-coupure">{m.intitule}</strong>
                <span className="mp-texte-doux">{detailMissionPartagee(m, langue)}</span>
              </li>
            ))}
          </ul>
        )}
        <p>
          {r.contact ? (
            <>
              {t("Contact du cabinet affiché :", "Firm contact shown:")}{" "}
              <strong>{r.contact}</strong>.
            </>
          ) : (
            t(
              "Aucun contact du cabinet n'est affiché à votre client.",
              "No firm contact is shown to your client.",
            )
          )}
        </p>
        <p className="mp-texte-doux">
          {t(
            "Selon son rôle, le contributeur ne voit pas les factures et l'investisseur ne voit aucune mission. Le budget, les temps, les coûts et les échanges internes ne font pas partie des partages.",
            "Depending on their role, the contributor does not see invoices and the investor does not see any engagement. The budget, time entries, costs and internal discussions are not part of the shared items.",
          )}
        </p>
        {voitToutesLesMissions ? null : (
          <p className="mp-texte-doux">
            {t(
              "Seules les missions que vous pouvez consulter apparaissent : d'autres missions de ce client peuvent être partagées par leurs responsables.",
              "Only the engagements you can view appear: other engagements of this client may be shared by their managers.",
            )}
          </p>
        )}
        {modifie ? (
          <p className="mp-partages__etat mp-partages__etat--modifie">
            <a href={`#${ID_FORMULAIRE_PARTAGES}`}>
              {t("Des modifications ne sont pas enregistrées", "Some changes are not saved")}
            </a>
            {t(
              " : ce résumé montre ce que votre client voit actuellement.",
              ": this summary shows what your client currently sees.",
            )}
          </p>
        ) : null}
      </div>
    </Carte>
  );
}

// --- Formulaire ------------------------------------------------------------------------------

export interface FormulairePartagesProps {
  clientId: string;
  missions: readonly MissionPartageable[];
  optionsContact: readonly OptionSelect[];
}

/**
 * Partages explicites (PUT /api/portail/partages) : tout est décoché par défaut ; rien ne part
 * avant « Enregistrer les partages ». Les missions que l'utilisateur ne dirige pas sont
 * affichées en lecture seule (l'API garde leurs partages intacts).
 */
export function FormulairePartages({
  clientId,
  missions,
  optionsContact,
}: FormulairePartagesProps) {
  const t = useT();
  const langue = useLangue();
  const { brouillon, initial, modifie, setBrouillon, enregistrer } = usePartages();
  const f = useFormulaire<never>();
  const [succes, setSucces] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const gerables = useMemo(
    () => new Set(missions.filter((m) => m.gerable).map((m) => m.id)),
    [missions],
  );
  const changer = (b: BrouillonPartages) => {
    setInfo(null);
    setSucces(null);
    setBrouillon(b);
  };

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setSucces(null);
    setInfo(null);
    if (!modifie) {
      setInfo(t("Aucune modification à enregistrer.", "No changes to save."));
      return;
    }
    await f.envoyer(
      { ok: true, charge: chargePartages(brouillon, initial, gerables) },
      (c) => api.put<PartagesClient>(cheminPartagesPortail(clientId), c),
      {
        rafraichir: false,
        messageSpecifique: (e) =>
          messageErreurPortailGestion(e, "partages", langue) ?? messageSpecifiqueLangue(langue)(e),
        apres: (r) => {
          enregistrer(r);
          setSucces(
            `${t("Partages enregistrés.", "Sharing saved.")} ${phraseResume(resumePartages(r), langue)}`,
          );
        },
      },
    );
  }

  return (
    <form
      id={ID_FORMULAIRE_PARTAGES}
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Partages avec le client", "Sharing with the client")}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={succes} refAlerte={f.refAlerte} />
      <Select
        libelle={t("Contact principal affiché au client", "Main contact shown to the client")}
        options={optionsContact}
        invite={t("Aucun contact affiché", "No contact shown")}
        value={brouillon.contact}
        onChange={(e) => changer({ ...brouillon, contact: e.target.value })}
        aide={t(
          "Seul nom du cabinet que votre client voit sur le portail, comme interlocuteur.",
          "The only firm name your client sees on the portal, as their contact person.",
        )}
      />
      {missions.length === 0 ? (
        <EtatVide
          titre={t(
            "Ce client n'a encore aucune mission à partager.",
            "This client has no engagement to share yet.",
          )}
          icone="dossier"
        >
          <p>
            {t(
              "Les missions créées pour ce client apparaîtront ici, non partagées.",
              "Engagements created for this client will appear here, not shared.",
            )}
          </p>
        </EtatVide>
      ) : (
        <ul className="mp-partages-missions">
          {missions.map((m) => (
            <li key={m.id}>
              <PartageMission mission={m} brouillon={brouillon} onChange={changer} />
            </li>
          ))}
        </ul>
      )}
      <div className="mp-partages__pied">
        <p
          role="status"
          className={modifie ? "mp-partages__etat mp-partages__etat--modifie" : "mp-partages__etat"}
        >
          {info ??
            (modifie
              ? t(
                  "Modifications non enregistrées : votre client ne les voit pas encore.",
                  "Unsaved changes: your client does not see them yet.",
                )
              : t("Aucune modification en attente.", "No pending changes."))}
        </p>
        <div className="mp-actions-formulaire">
          <Bouton
            variante="discret"
            disabled={!modifie || f.enCours}
            onClick={() => changer(initial)}
          >
            {t("Annuler les modifications", "Cancel changes")}
          </Bouton>
          <Bouton
            type="submit"
            chargement={f.enCours}
            texteChargement={t("Enregistrement…", "Saving…")}
          >
            {t("Enregistrer les partages", "Save sharing")}
          </Bouton>
        </div>
      </div>
    </form>
  );
}

function PartageMission({
  mission: m,
  brouillon,
  onChange,
}: {
  mission: MissionPartageable;
  brouillon: BrouillonPartages;
  onChange: (b: BrouillonPartages) => void;
}) {
  const t = useT();
  const langue = useLangue();
  const options = brouillon.missions[m.id];
  const partagee = options !== undefined;
  const statutBase = STATUT_MISSION[m.statut] ?? { libelle: m.statut, tonalite: "neutre" as const };
  const statut = {
    ...statutBase,
    libelle: STATUT_MISSION[m.statut] ? libelleStatutMission(m.statut, langue) : statutBase.libelle,
  };
  // Nom accessible complet hors du groupe (liste des champs d'un lecteur d'écran).
  const pour = <span className="mp-visuellement-cache">{` — ${m.intitule}`}</span>;
  return (
    <fieldset
      className={
        partagee ? "mp-partage-mission mp-partage-mission--partagee" : "mp-partage-mission"
      }
      disabled={!m.gerable}
    >
      <legend>
        <span className="mp-partage-mission__titre">
          <span>{m.intitule}</span>
          <BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>
          <BadgeStatut tonalite={partagee ? "succes" : "neutre"}>
            {partagee ? t("Partagée", "Shared") : t("Non partagée", "Not shared")}
          </BadgeStatut>
        </span>
      </legend>
      {m.gerable ? null : (
        <p className="mp-texte-doux mp-texte-petit">
          {t(
            "Partages gérés par le directeur ou le chef de cette mission : lecture seule.",
            "Sharing is managed by the director or manager of this engagement: read-only.",
          )}
        </p>
      )}
      <CaseACocher
        libelle={
          <>
            {t("Partager la mission", "Share the engagement")}
            {pour}
          </>
        }
        aide={t(
          "Le client voit son intitulé, son statut et ses dates. Cocher un élément ci-dessous la partage aussi.",
          "The client sees its title, status and dates. Checking an item below also shares it.",
        )}
        checked={partagee}
        onChange={(e) => onChange(basculerMission(brouillon, m.id, e.target.checked))}
      />
      <div className="mp-partage-mission__options">
        <CaseACocher
          libelle={
            <>
              {t("Jalons", "Milestones")}
              {pour}
            </>
          }
          aide={t(
            "Le dirigeant client peut les valider.",
            "The client executive can approve them.",
          )}
          checked={options?.jalons ?? false}
          onChange={(e) => onChange(basculerOption(brouillon, m.id, "jalons", e.target.checked))}
        />
        <CaseACocher
          libelle={
            <>
              {t("Factures émises", "Issued invoices")}
              {pour}
            </>
          }
          aide={t(
            "Visibles du dirigeant client, avec leur état de paiement.",
            "Visible to the client executive, with their payment status.",
          )}
          checked={options?.factures ?? false}
          onChange={(e) => onChange(basculerOption(brouillon, m.id, "factures", e.target.checked))}
        />
      </div>
      <DocumentsMission mission={m} brouillon={brouillon} onChange={onChange} pour={pour} />
    </fieldset>
  );
}

const libelleDocument = (d: LigneDocumentPartage, langue: Langue, t: Traduire) =>
  `${libelleTypeDocument(d.type, langue) ?? t("Document", "Document")} — ${d.nom} (version ${d.version})`;

function DocumentsMission({
  mission: m,
  brouillon,
  onChange,
  pour,
}: {
  mission: MissionPartageable;
  brouillon: BrouillonPartages;
  onChange: (b: BrouillonPartages) => void;
  pour: ReactNode;
}) {
  const t = useT();
  const langue = useLangue();
  return (
    <div className="mp-pile">
      <p className="mp-partage-mission__sous-titre">
        {t("Livrables et lettres de mission", "Deliverables and engagement letters")}
        {pour}
      </p>
      {m.documentsIndisponibles ? (
        <Alerte tonalite="attention" annonce="aucune">
          <p>
            {t(
              "La liste des documents de cette mission n'a pas pu être chargée : seuls ceux déjà partagés figurent ici. Rechargez la page pour en partager d'autres.",
              "The list of documents of this engagement could not be loaded: only those already shared appear here. Reload the page to share others.",
            )}
          </p>
        </Alerte>
      ) : null}
      {m.documents.length === 0 ? (
        <p className="mp-texte-doux mp-texte-petit">
          {m.gerable
            ? t(
                "Aucun livrable ni lettre de mission déposé pour cette mission.",
                "No deliverable or engagement letter uploaded for this engagement.",
              )
            : t("Aucun document partagé.", "No document shared.")}
        </p>
      ) : (
        <ul className="mp-partage-mission__documents">
          {m.documents.map((d) => (
            <li key={d.id}>
              {d.partageable ? (
                <CaseACocher
                  libelle={libelleDocument(d, langue, t)}
                  aide={
                    d.versionPlusRecente
                      ? t(
                          `Version ${d.versionPlusRecente} disponible : partagez-la pour remplacer celle-ci.`,
                          `Version ${d.versionPlusRecente} available: share it to replace this one.`,
                        )
                      : undefined
                  }
                  checked={d.id in brouillon.documents}
                  onChange={(e) =>
                    onChange(basculerDocument(brouillon, d.id, m.id, e.target.checked))
                  }
                />
              ) : (
                <p className="mp-partage-mission__indisponible">
                  <span className="mp-coupure">{libelleDocument(d, langue, t)}</span>
                  <BadgeStatut tonalite="attention">
                    {t("Non partageable", "Not shareable")}
                  </BadgeStatut>
                  <span className="mp-texte-petit">{d.raison}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
