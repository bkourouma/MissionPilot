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
import { STATUT_MISSION, TYPE_DOCUMENT_LIBELLES } from "../../lib/missions";
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
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { Carte } from "../ui/Carte";
import { CaseACocher } from "../ui/CaseACocher";
import { EtatVide } from "../ui/EtatListe";
import { Select, type OptionSelect } from "../ui/Select";
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
  const { enregistre, modifie } = usePartages();
  const r = resumePartages(enregistre);
  return (
    <Carte titre="Ce que voit votre client">
      <div className="mp-pile">
        {r.rien ? (
          <Alerte
            tonalite="info"
            annonce="aucune"
            titre="Votre client ne voit encore aucune mission."
          >
            <p>
              Rien n&apos;est partagé par défaut. Cochez plus bas les missions, jalons, factures et
              documents à lui montrer, puis enregistrez.
            </p>
          </Alerte>
        ) : (
          <ul className="mp-resume-portail" aria-label="Missions partagées avec le client">
            {r.missions.map((m) => (
              <li key={m.id} className="mp-resume-portail__element">
                <strong className="mp-coupure">{m.intitule}</strong>
                <span className="mp-texte-doux">{detailMissionPartagee(m)}</span>
              </li>
            ))}
          </ul>
        )}
        <p>
          {r.contact ? (
            <>
              Contact du cabinet affiché : <strong>{r.contact}</strong>.
            </>
          ) : (
            "Aucun contact du cabinet n'est affiché à votre client."
          )}
        </p>
        <p className="mp-texte-doux">
          Selon son rôle, le contributeur ne voit pas les factures et l&apos;investisseur ne voit
          aucune mission. Le budget, les temps, les coûts et les échanges internes ne font pas
          partie des partages.
        </p>
        {voitToutesLesMissions ? null : (
          <p className="mp-texte-doux">
            Seules les missions que vous pouvez consulter apparaissent : d&apos;autres missions de
            ce client peuvent être partagées par leurs responsables.
          </p>
        )}
        {modifie ? (
          <p className="mp-partages__etat mp-partages__etat--modifie">
            <a href={`#${ID_FORMULAIRE_PARTAGES}`}>Des modifications ne sont pas enregistrées</a> :
            ce résumé montre ce que votre client voit actuellement.
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
      setInfo("Aucune modification à enregistrer.");
      return;
    }
    await f.envoyer(
      { ok: true, charge: chargePartages(brouillon, initial, gerables) },
      (c) => api.put<PartagesClient>(cheminPartagesPortail(clientId), c),
      {
        rafraichir: false,
        messageSpecifique: (e) => messageErreurPortailGestion(e, "partages"),
        apres: (r) => {
          enregistrer(r);
          setSucces(`Partages enregistrés. ${phraseResume(resumePartages(r))}`);
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
      aria-label="Partages avec le client"
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={succes} refAlerte={f.refAlerte} />
      <Select
        libelle="Contact principal affiché au client"
        options={optionsContact}
        invite="Aucun contact affiché"
        value={brouillon.contact}
        onChange={(e) => changer({ ...brouillon, contact: e.target.value })}
        aide="Seul nom du cabinet que votre client voit sur le portail, comme interlocuteur."
      />
      {missions.length === 0 ? (
        <EtatVide titre="Ce client n'a encore aucune mission à partager." icone="dossier">
          <p>Les missions créées pour ce client apparaîtront ici, non partagées.</p>
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
              ? "Modifications non enregistrées : votre client ne les voit pas encore."
              : "Aucune modification en attente.")}
        </p>
        <div className="mp-actions-formulaire">
          <Bouton
            variante="discret"
            disabled={!modifie || f.enCours}
            onClick={() => changer(initial)}
          >
            Annuler les modifications
          </Bouton>
          <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
            Enregistrer les partages
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
  const options = brouillon.missions[m.id];
  const partagee = options !== undefined;
  const statut = STATUT_MISSION[m.statut] ?? { libelle: m.statut, tonalite: "neutre" as const };
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
            {partagee ? "Partagée" : "Non partagée"}
          </BadgeStatut>
        </span>
      </legend>
      {m.gerable ? null : (
        <p className="mp-texte-doux mp-texte-petit">
          Partages gérés par le directeur ou le chef de cette mission : lecture seule.
        </p>
      )}
      <CaseACocher
        libelle={<>Partager la mission{pour}</>}
        aide="Le client voit son intitulé, son statut et ses dates. Cocher un élément ci-dessous la partage aussi."
        checked={partagee}
        onChange={(e) => onChange(basculerMission(brouillon, m.id, e.target.checked))}
      />
      <div className="mp-partage-mission__options">
        <CaseACocher
          libelle={<>Jalons{pour}</>}
          aide="Le dirigeant client peut les valider."
          checked={options?.jalons ?? false}
          onChange={(e) => onChange(basculerOption(brouillon, m.id, "jalons", e.target.checked))}
        />
        <CaseACocher
          libelle={<>Factures émises{pour}</>}
          aide="Visibles du dirigeant client, avec leur état de paiement."
          checked={options?.factures ?? false}
          onChange={(e) => onChange(basculerOption(brouillon, m.id, "factures", e.target.checked))}
        />
      </div>
      <DocumentsMission mission={m} brouillon={brouillon} onChange={onChange} pour={pour} />
    </fieldset>
  );
}

const libelleDocument = (d: LigneDocumentPartage) =>
  `${TYPE_DOCUMENT_LIBELLES[d.type] ?? "Document"} — ${d.nom} (version ${d.version})`;

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
  return (
    <div className="mp-pile">
      <p className="mp-partage-mission__sous-titre">Livrables et lettres de mission{pour}</p>
      {m.documentsIndisponibles ? (
        <Alerte tonalite="attention" annonce="aucune">
          <p>
            La liste des documents de cette mission n&apos;a pas pu être chargée : seuls ceux déjà
            partagés figurent ici. Rechargez la page pour en partager d&apos;autres.
          </p>
        </Alerte>
      ) : null}
      {m.documents.length === 0 ? (
        <p className="mp-texte-doux mp-texte-petit">
          {m.gerable
            ? "Aucun livrable ni lettre de mission déposé pour cette mission."
            : "Aucun document partagé."}
        </p>
      ) : (
        <ul className="mp-partage-mission__documents">
          {m.documents.map((d) => (
            <li key={d.id}>
              {d.partageable ? (
                <CaseACocher
                  libelle={libelleDocument(d)}
                  aide={
                    d.versionPlusRecente
                      ? `Version ${d.versionPlusRecente} disponible : partagez-la pour remplacer celle-ci.`
                      : undefined
                  }
                  checked={d.id in brouillon.documents}
                  onChange={(e) =>
                    onChange(basculerDocument(brouillon, d.id, m.id, e.target.checked))
                  }
                />
              ) : (
                <p className="mp-partage-mission__indisponible">
                  <span className="mp-coupure">{libelleDocument(d)}</span>
                  <BadgeStatut tonalite="attention">Non partageable</BadgeStatut>
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
