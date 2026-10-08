"use client";

import { useState, type FormEvent } from "react";
import type { Role } from "@missionpilot/shared";
import { BarreProgression } from "../../../../../../components/questionnaires/BarreProgression";
import { BoutonConfirmation } from "../../../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../../../components/formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../../../../../../components/formulaires/useAttenteRafraichissement";
import { useFormulaire } from "../../../../../../components/formulaires/useFormulaire";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { Bouton } from "../../../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../../../components/ui/CaseACocher";
import { Champ } from "../../../../../../components/ui/Champ";
import { Icone } from "../../../../../../components/ui/Icone";
import { api } from "../../../../../../lib/api";
import { formaterDateHeure } from "../../../../../../lib/format";
import {
  actionsEnvoi,
  dateDuJour,
  libelleStatut,
  messageQuestionnaire,
  messageRelance,
  reglagesDepuisEnvoi,
  relanceRecente,
  repondantEnAttente,
  STATUT_REPONSE,
  texteRelances,
  validerReglages,
  type EnvoiDetail,
  type RepondantEnvoi,
  type SaisieReglages,
} from "../../../../../../lib/questionnaires";
import "../../../../../../components/questionnaires/questionnaires.css";

export interface SuiviEnvoiProps {
  envoi: EnvoiDetail;
  roles: readonly Role[];
  missionCloturee: boolean;
}

const cheminEnvoi = (id: string, action = "") =>
  `/api/questionnaires/envois/${encodeURIComponent(id)}${action}`;

/**
 * Suivi d'un envoi : actions (envoyer, relancer, clore), réglages (relances automatiques,
 * date limite) et suivi par répondant (statut, progression calculée par l'API, relances).
 * Aucune réponse n'est lue ici : seule la progression d'une saisie est visible.
 */
export function SuiviEnvoi({ envoi, roles, missionCloturee }: SuiviEnvoiProps) {
  const a = actionsEnvoi(envoi, { roles, missionCloturee });
  const enAttente = envoi.repondants.filter((r) => repondantEnAttente(envoi, r));
  const relancesTotal = envoi.repondants.reduce((n, r) => n + r.relances, 0);
  const cle = `${envoi.statut}-${relancesTotal}`;

  return (
    <div className="mp-pile mp-pile--large">
      {a.raisonLectureSeule ? (
        <p className="mp-indice mp-texte-doux">
          <Icone nom="cadenas" taille={16} />
          <span>{a.raisonLectureSeule}</span>
        </p>
      ) : null}
      {a.envoyer || a.relancer || a.clore ? (
        <ActionsPrincipales envoi={envoi} enAttente={enAttente.length} cle={cle} actions={a} />
      ) : null}
      {a.modifierReglages ? <ReglagesEnvoi envoi={envoi} /> : null}
      {envoi.mode === "collectif" && envoi.reponse_collective ? (
        <ReponsePartagee envoi={envoi} />
      ) : null}
      <section className="mp-pile" aria-labelledby="titre-repondants">
        <h3 id="titre-repondants" className="mp-section__titre">
          {`Répondants (${envoi.repondants.length})`}
        </h3>
        <ul className="mp-liste-lignes" aria-label="Répondants du questionnaire">
          {envoi.repondants.map((r) => (
            <LigneRepondant
              key={r.id}
              envoi={envoi}
              r={r}
              relancer={a.relancer && repondantEnAttente(envoi, r)}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function ActionsPrincipales({
  envoi,
  enAttente,
  cle,
  actions,
}: {
  envoi: EnvoiDetail;
  enAttente: number;
  cle: string;
  actions: ReturnType<typeof actionsEnvoi>;
}) {
  const f = useFormulaire<never>();
  const [annonce, setAnnonce] = useState<string | null>(null);
  const [attente, marquer] = useAttenteRafraichissement(cle);
  const n = envoi.repondants.length;
  // Le bouton de confirmation revient à son état initial après l'action, réussie ou non
  // (`false`) : l'écran rafraîchi retire ensuite les actions devenues impossibles.
  const executer = async (
    action: "envoyer" | "relancer" | "clore",
    succes: (r: { relances?: number }) => string,
  ): Promise<false> => {
    await f.envoyer(
      { ok: true, charge: action === "relancer" ? {} : undefined },
      (c) => api.post<{ relances?: number }>(cheminEnvoi(envoi.id, `/${action}`), c),
      {
        messageSpecifique: action === "relancer" ? messageRelance : messageQuestionnaire,
        apres: (r) => {
          setAnnonce(succes(r));
          marquer();
        },
      },
    );
    return false;
  };

  return (
    <section className="mp-pile" aria-labelledby="titre-actions-envoi">
      <h3 id="titre-actions-envoi" className="mp-visuellement-cache">
        Actions sur le questionnaire
      </h3>
      <div className="mp-barre-actions">
        {actions.envoyer ? (
          <BoutonConfirmation
            libelle={`Envoyer aux ${n} répondant${n > 1 ? "s" : ""}`}
            icone="envoyer"
            variante="primaire"
            question={`Envoyer « ${envoi.titre} » ? Chaque répondant reçoit une notification et un e-mail${envoi.relances_auto ? " ; les relances automatiques (J+3, J+7) sont programmées" : ""}.`}
            libelleConfirmation="Oui, envoyer"
            texteChargement="Envoi…"
            action={() =>
              executer("envoyer", () => `Questionnaire envoyé à ${n} répondant${n > 1 ? "s" : ""}.`)
            }
          />
        ) : null}
        {actions.relancer ? (
          enAttente > 0 ? (
            <BoutonConfirmation
              libelle={`Relancer les ${enAttente} répondant${enAttente > 1 ? "s" : ""} en attente`}
              icone="courrier"
              question={`Relancer par e-mail ${enAttente > 1 ? `les ${enAttente} répondants` : "le répondant"} qui n'${enAttente > 1 ? "ont" : "a"} pas soumis ? Un répondant relancé il y a moins de 24 h ne l'est pas de nouveau.`}
              libelleConfirmation="Oui, relancer"
              texteChargement="Relance…"
              action={() =>
                executer("relancer", (r) => {
                  const k = r.relances ?? 0;
                  return `${k} relance${k > 1 ? "s" : ""} envoyée${k > 1 ? "s" : ""} par e-mail.`;
                })
              }
            />
          ) : (
            <p className="mp-texte-doux">
              Tous les répondants ont soumis : aucune relance à envoyer.
            </p>
          )
        ) : null}
        {actions.clore ? (
          <BoutonConfirmation
            libelle="Clore le questionnaire"
            icone="cadenas"
            question="Clore le questionnaire ? Plus aucune saisie ni relance ne sera possible ; les réponses soumises restent lisibles."
            libelleConfirmation="Oui, clore"
            texteChargement="Clôture…"
            action={() => executer("clore", () => "Questionnaire clos : la saisie est fermée.")}
          />
        ) : null}
      </div>
      {attente ? (
        <p className="mp-texte-doux mp-texte-petit" role="status">
          Mise à jour du suivi…
        </p>
      ) : null}
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={annonce}
        refAlerte={f.refAlerte}
        titreErreur="Action impossible"
      />
    </section>
  );
}

function ReglagesEnvoi({ envoi }: { envoi: EnvoiDetail }) {
  const [s, setS] = useState<SaisieReglages>(() => reglagesDepuisEnvoi(envoi));
  const f = useFormulaire<"date_limite" | "relances_auto">();
  const aujourdhui = dateDuJour(new Date());
  const avant = reglagesDepuisEnvoi(envoi);
  const modifie = s.relances_auto !== avant.relances_auto || s.date_limite !== avant.date_limite;

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerReglages(s, envoi, aujourdhui),
      (c) => api.patch<EnvoiDetail>(cheminEnvoi(envoi.id), c),
      { succes: "Réglages enregistrés.", messageSpecifique: messageQuestionnaire },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-formulaire--ligne mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-labelledby="titre-reglages-envoi"
    >
      <h3 id="titre-reglages-envoi" className="mp-sous-formulaire__titre">
        Réglages
      </h3>
      <div className="mp-grille-champs">
        <CaseACocher
          libelle="Relances automatiques par e-mail"
          aide={
            envoi.statut === "brouillon"
              ? "À J+3 puis J+7 après l'envoi, aux seuls répondants qui n'ont pas soumis."
              : "J+3 puis J+7 après l'envoi, aux seuls répondants qui n'ont pas soumis. Désactivées, les relances à venir ne partent pas."
          }
          checked={s.relances_auto}
          onChange={(e) => setS((x) => ({ ...x, relances_auto: e.target.checked }))}
        />
        <Champ
          libelle="Date limite indicative"
          name="date_limite"
          type="date"
          min={aujourdhui}
          value={s.date_limite}
          erreur={f.erreurs.date_limite ?? f.erreurs.relances_auto}
          aide="Facultative, à titre d'indication : la vider retire la date. Passée, elle n'empêche pas de répondre tant que vous n'avez pas clos le questionnaire."
          onChange={(e) => setS((x) => ({ ...x, date_limite: e.target.value }))}
        />
      </div>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          chargement={f.enCours}
          texteChargement="Enregistrement…"
          disabled={!modifie}
        >
          Enregistrer les réglages
        </Bouton>
      </div>
    </form>
  );
}

function ReponsePartagee({ envoi }: { envoi: EnvoiDetail }) {
  const c = envoi.reponse_collective;
  if (!c) return null;
  const s = libelleStatut(STATUT_REPONSE, c.statut);
  return (
    <section className="mp-carte" aria-labelledby="titre-reponse-partagee">
      <div className="mp-carte__entete">
        <h3 id="titre-reponse-partagee" className="mp-carte__titre">
          Réponse partagée
        </h3>
        <BadgeStatut tonalite={s.tonalite}>{s.libelle}</BadgeStatut>
      </div>
      <BarreProgression progression={c.progression} libelle="Progression de la réponse partagée" />
      <p className="mp-texte-doux mp-texte-petit">
        {c.statut === "soumise" && c.soumise_le
          ? `Soumise le ${formaterDateHeure(c.soumise_le)}${c.soumise_par_nom ? ` par ${c.soumise_par_nom}` : ""} : elle est verrouillée.`
          : c.derniere_saisie
            ? `Dernière saisie le ${formaterDateHeure(c.derniere_saisie)}. Le contenu d'une saisie en cours n'est pas visible du cabinet.`
            : "Aucune saisie pour l'instant."}
      </p>
    </section>
  );
}

function LigneRepondant({
  envoi,
  r,
  relancer,
}: {
  envoi: EnvoiDetail;
  r: RepondantEnvoi;
  relancer: boolean;
}) {
  const f = useFormulaire<never>();
  const [annonce, setAnnonce] = useState<string | null>(null);
  const [attente, marquer] = useAttenteRafraichissement(`${r.relances}`);
  const recente = relanceRecente(r.derniere_relance, new Date());
  const statut = r.statut ? libelleStatut(STATUT_REPONSE, r.statut) : null;

  return (
    <li className="mp-liste-lignes__ligne">
      <div className="mp-repondant mp-pleine-largeur">
        <div className="mp-repondant__identite">
          <strong>{r.nom}</strong>
          <span className="mp-texte-petit">
            {r.fonction ? `${r.fonction} · ${r.email}` : r.email}
          </span>
          {statut ? (
            <span>
              <BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>
            </span>
          ) : null}
        </div>
        <div className="mp-repondant__suivi">
          {r.progression ? (
            <BarreProgression progression={r.progression} libelle={`Progression de ${r.nom}`} />
          ) : null}
          <span className="mp-texte-doux mp-texte-petit">
            {r.statut === "soumise" && r.soumise_le
              ? `Soumis le ${formaterDateHeure(r.soumise_le)}`
              : r.derniere_saisie
                ? `Dernière saisie le ${formaterDateHeure(r.derniere_saisie)}`
                : envoi.mode === "collectif"
                  ? "Contribue à la réponse partagée"
                  : "Aucune saisie"}
          </span>
          <span className="mp-texte-doux mp-texte-petit">
            {`${texteRelances(r.relances)}${r.derniere_relance ? `, la dernière le ${formaterDateHeure(r.derniere_relance)}` : ""}`}
          </span>
          {recente && relancer ? (
            <span className="mp-indice mp-texte-petit">
              <Icone nom="horloge" taille={16} />
              <span>
                Relancé il y a moins de 24 h : une nouvelle relance sera refusée d'ici là.
              </span>
            </span>
          ) : null}
        </div>
        {relancer ? (
          <div>
            <Bouton
              variante="secondaire"
              icone="courrier"
              chargement={f.enCours || attente}
              texteChargement="Relance…"
              aria-label={`Relancer ${r.nom} par e-mail`}
              onClick={() =>
                void f.envoyer(
                  { ok: true, charge: { repondant_ids: [r.id] } },
                  (c) => api.post<{ relances: number }>(cheminEnvoi(envoi.id, "/relancer"), c),
                  {
                    messageSpecifique: messageRelance,
                    apres: (res) => {
                      setAnnonce(
                        res.relances > 0
                          ? `${r.nom} a été relancé par e-mail.`
                          : `Aucune relance envoyée : ${r.nom} ne peut plus répondre (compte ou accès au portail inactif).`,
                      );
                      marquer();
                    },
                  },
                )
              }
            >
              Relancer
            </Bouton>
          </div>
        ) : null}
      </div>
      {f.erreurGlobale || annonce ? (
        <div className="mp-pleine-largeur">
          <RetourFormulaire
            erreur={f.erreurGlobale}
            succes={annonce}
            refAlerte={f.refAlerte}
            titreErreur={`Relance de ${r.nom} impossible`}
          />
        </div>
      ) : null}
    </li>
  );
}
