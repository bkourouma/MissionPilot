"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { ModeFacturation } from "@missionpilot/shared";
import { BoutonConfirmation } from "../../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../../../../../components/formulaires/useAttenteRafraichissement";
import { useFermetureDifferee } from "../../../../../components/formulaires/useFermetureDifferee";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Bouton } from "../../../../../components/ui/Bouton";
import { Carte } from "../../../../../components/ui/Carte";
import { Champ } from "../../../../../components/ui/Champ";
import { Select, type OptionSelect } from "../../../../../components/ui/Select";
import { useLangue, useT } from "../../../../../components/i18n/FournisseurLangue";
import { api } from "../../../../../lib/api";
import {
  besoinGeneration,
  echeanceModifiable,
  libellePeriodicite,
  libelleStatutEcheance,
  libelleTypeEcheance,
  messageEcheancier,
  optionsStatutsEcheance,
  optionsTypesSaisis,
  PERIODICITE_LIBELLES,
  SAISIE_ECHEANCE_VIDE,
  SAISIE_GENERATION_VIDE,
  saisieDepuisEcheance,
  STATUT_ECHEANCE,
  validerEcheance,
  validerGeneration,
  validerModificationEcheance,
  validerRegie,
  type ChampEcheance,
  type ChampGeneration,
  type Echeance,
  type Echeancier,
  type SaisieEcheance,
  type SaisieGeneration,
} from "../../../../../lib/echeancier";
import {
  formaterDate,
  formaterMontantMineur,
  formaterNombre,
  type Devise,
  libelleDevise,
} from "../../../../../lib/format";
import { aideMontant } from "../../../../../lib/saisie";

export interface EcheancierMissionProps {
  missionId: string;
  mode: ModeFacturation;
  echeancier: Echeancier;
  jalons: OptionSelect[];
  gerer: boolean;
}

/** Échéancier (FIN-06) : synthèse calculée par l'API, échéances et actions de gestion. */
export function EcheancierMission({
  missionId,
  mode,
  echeancier: e,
  jalons,
  gerer,
}: EcheancierMissionProps) {
  const t = useT();
  const langue = useLangue();
  const [ajout, setAjout] = useState(false);
  const m = (v: number | null) => formaterMontantMineur(v, e.devise, langue);
  const contexte = { budget: e.budget_signe, devise: e.devise, jalons };
  return (
    <Carte titre={t("Échéancier de facturation", "Billing schedule")}>
      <div className="mp-pile">
        <dl className="mp-totaux">
          <div className="mp-totaux__element">
            <dt className="mp-totaux__libelle">
              {t("Budget signé (honoraires)", "Signed budget (fees)")}
            </dt>
            <dd className="mp-totaux__valeur">{m(e.budget_signe)}</dd>
          </div>
          <div className="mp-totaux__element">
            <dt className="mp-totaux__libelle">{t("Total de l'échéancier", "Schedule total")}</dt>
            <dd className="mp-totaux__valeur">{m(e.total)}</dd>
          </div>
          <div className="mp-totaux__element">
            <dt className="mp-totaux__libelle">{t("Reste à planifier", "Left to schedule")}</dt>
            <dd className="mp-totaux__valeur">{m(e.reste_a_planifier)}</dd>
          </div>
        </dl>
        {e.depassement !== null && e.depassement > 0 ? (
          <Alerte
            tonalite="danger"
            annonce="aucune"
            titre={t("Échéancier au-delà du budget signé", "Schedule exceeds the signed budget")}
          >
            <p>
              {t(
                `Dépassement : ${m(e.depassement)}. Faites valider une révision du budget ou réduisez les échéances.`,
                `Overrun: ${m(e.depassement)}. Get a budget revision approved or reduce the due dates.`,
              )}
            </p>
          </Alerte>
        ) : null}
        <p className="mp-texte-doux mp-texte-petit">
          {t(
            "Le total des échéances est plafonné par le budget signé : toute échéance qui le dépasserait est refusée.",
            "The total of the due dates is capped by the signed budget: any due date that would exceed it is refused.",
          )}
        </p>
        {e.echeances.length === 0 ? (
          <p className="mp-texte-doux">
            {t("Aucune échéance pour l'instant.", "No due dates yet.")}
          </p>
        ) : (
          <ul className="mp-liste-lignes" aria-label={t("Échéances", "Due dates")}>
            {e.echeances.map((x) => (
              <LigneEcheance key={x.id} echeance={x} gerer={gerer} {...contexte} />
            ))}
          </ul>
        )}
        {gerer && e.echeances.length === 0 && besoinGeneration(mode) !== "regie" ? (
          <Generation missionId={missionId} mode={mode} {...contexte} />
        ) : null}
        {gerer && besoinGeneration(mode) === "regie" ? (
          <Regie missionId={missionId} {...contexte} />
        ) : null}
        {gerer ? (
          ajout ? (
            <FormulaireEcheance
              titre={t("Nouvelle échéance", "New due date")}
              initial={SAISIE_ECHEANCE_VIDE}
              creation
              {...contexte}
              onFin={() => setAjout(false)}
              valider={(s) => validerEcheance(s, e.devise, langue)}
              appel={(c) => api.post(`/api/missions/${encodeURIComponent(missionId)}/echeances`, c)}
            />
          ) : (
            <div>
              <Bouton variante="secondaire" icone="plus" onClick={() => setAjout(true)}>
                {t("Ajouter une échéance", "Add a due date")}
              </Bouton>
            </div>
          )
        ) : null}
      </div>
    </Carte>
  );
}

interface Contexte {
  budget: number | null;
  devise: Devise;
  jalons: OptionSelect[];
}

function LigneEcheance({
  echeance: x,
  gerer,
  budget,
  devise,
  jalons,
}: { echeance: Echeance; gerer: boolean } & Contexte) {
  const t = useT();
  const langue = useLangue();
  const [edition, setEdition, fermerApresRafraichissement] = useFermetureDifferee<true>(
    `${x.statut}-${x.modifie_le ?? ""}`,
  );
  const f = useFormulaire<never>();
  const [attente, marquer] = useAttenteRafraichissement(`${x.statut}-${x.libelle}-${x.montant}`);
  const chemin = `/api/echeances/${encodeURIComponent(x.id)}`;
  const modifiable = gerer && echeanceModifiable(x);
  const jalon = jalons.find((j) => j.valeur === x.jalon_id)?.libelle;
  const msg = (err: unknown) => messageEcheancier(err, budget, devise, langue);
  const basculer = () =>
    f.envoyer(
      { ok: true, charge: { statut: x.statut === "prevue" ? "a_facturer" : "prevue" } },
      (c) => api.patch(chemin, c),
      {
        apres: marquer,
        messageSpecifique: msg,
        succes:
          x.statut === "prevue"
            ? t(`« ${x.libelle} » est à facturer.`, `"${x.libelle}" is marked to invoice.`)
            : t(`« ${x.libelle} » est remise en prévue.`, `"${x.libelle}" is set back to planned.`),
      },
    );
  return (
    <li className="mp-liste-lignes__ligne">
      <span className="mp-liste-lignes__texte">
        <strong>{x.libelle}</strong>
        <span className="mp-texte-doux">
          {[
            libelleTypeEcheance(x.type, langue),
            t(
              `prévue le ${formaterDate(x.date_prevue)}`,
              `planned on ${formaterDate(x.date_prevue, "UTC", langue)}`,
            ),
            x.pourcentage !== null
              ? t(
                  `${formaterNombre(x.pourcentage, 4)} % du budget`,
                  `${formaterNombre(x.pourcentage, 4, langue)}% of the budget`,
                )
              : null,
            x.periode_debut && x.periode_fin
              ? t(
                  `temps du ${formaterDate(x.periode_debut)} au ${formaterDate(x.periode_fin)}`,
                  `time from ${formaterDate(x.periode_debut, "UTC", langue)} to ${formaterDate(x.periode_fin, "UTC", langue)}`,
                )
              : null,
            jalon ? t(`jalon : ${jalon}`, `milestone: ${jalon}`) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {x.facture_id ? (
          <Link href={`/facturation/${x.facture_id}`} className="mp-texte-petit">
            {t("Rattachée à une facture en cours", "Linked to an invoice in progress")}
          </Link>
        ) : null}
      </span>
      <span className="mp-montant">{formaterMontantMineur(x.montant, x.devise, langue)}</span>
      <BadgeStatut tonalite={STATUT_ECHEANCE[x.statut].tonalite}>
        {libelleStatutEcheance(x.statut, langue)}
      </BadgeStatut>
      {modifiable && !edition ? (
        <div className="mp-barre-actions mp-barre-actions--compacte">
          <Bouton
            variante="secondaire"
            chargement={f.enCours || attente}
            texteChargement={t("Enregistrement…", "Saving…")}
            onClick={basculer}
            aria-label={
              x.statut === "prevue"
                ? t(`Marquer ${x.libelle} à facturer`, `Mark ${x.libelle} as to invoice`)
                : t(`Remettre ${x.libelle} en prévue`, `Set ${x.libelle} back to planned`)
            }
          >
            {x.statut === "prevue"
              ? t("Marquer à facturer", "Mark as to invoice")
              : t("Remettre en prévue", "Set back to planned")}
          </Bouton>
          <Bouton
            variante="discret"
            icone="crayon"
            onClick={() => setEdition(true)}
            aria-label={t(`Modifier l'échéance ${x.libelle}`, `Edit due date ${x.libelle}`)}
          >
            {t("Modifier", "Edit")}
          </Bouton>
          <BoutonConfirmation
            libelle={t("Supprimer", "Delete")}
            variante="discret"
            icone="corbeille"
            ariaLabel={t(`Supprimer l'échéance ${x.libelle}`, `Delete due date ${x.libelle}`)}
            question={t(
              `Supprimer l'échéance « ${x.libelle} » ?`,
              `Delete the due date "${x.libelle}"?`,
            )}
            libelleConfirmation={t("Oui, supprimer", "Yes, delete")}
            texteChargement={t("Suppression…", "Deleting…")}
            action={() =>
              f.envoyer({ ok: true, charge: null }, () => api.supprimer(chemin), {
                messageSpecifique: msg,
              })
            }
          />
        </div>
      ) : null}
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Action impossible", "Action not possible")}
      />
      {edition ? (
        <FormulaireEcheance
          titre={t(`Modifier l'échéance ${x.libelle}`, `Edit due date ${x.libelle}`)}
          initial={saisieDepuisEcheance(x)}
          creation={false}
          regie={x.type === "regie"}
          budget={budget}
          devise={devise}
          jalons={jalons}
          onFin={() => setEdition(null)}
          onEnregistre={fermerApresRafraichissement}
          valider={(s) => validerModificationEcheance(s, devise, x.type, langue)}
          appel={(c) => api.patch(chemin, c)}
        />
      ) : null}
    </li>
  );
}

function FormulaireEcheance({
  titre,
  initial,
  creation,
  regie = false,
  budget,
  devise,
  jalons,
  onFin,
  onEnregistre,
  valider,
  appel,
}: {
  titre: string;
  initial: SaisieEcheance;
  creation: boolean;
  regie?: boolean;
  onFin: () => void;
  /** Après enregistrement (sinon `onFin`) : fermeture différée jusqu'au rafraîchissement. */
  onEnregistre?: () => void;
  valider: (s: SaisieEcheance) => ReturnType<typeof validerEcheance>;
  appel: (c: Record<string, unknown>) => Promise<unknown>;
} & Contexte) {
  const t = useT();
  const langue = useLangue();
  const [s, setS] = useState<SaisieEcheance>(initial);
  const f = useFormulaire<ChampEcheance>();
  const maj = <K extends keyof SaisieEcheance>(k: K, v: SaisieEcheance[K]) =>
    setS((x) => ({ ...x, [k]: v }));
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(valider(s), appel, {
      apres: onEnregistre ?? onFin,
      messageSpecifique: (e) => messageEcheancier(e, budget, devise, langue),
    });
  }
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire mp-pleine-largeur"
      noValidate
      onSubmit={soumettre}
      aria-label={titre}
    >
      <p className="mp-sous-formulaire__titre">{titre}</p>
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs mp-grille-champs--bas">
        {creation ? (
          <Select
            libelle={t("Type", "Type")}
            options={optionsTypesSaisis(langue)}
            required
            value={s.type}
            onChange={(e) => maj("type", e.target.value)}
            erreur={f.erreurs.type}
          />
        ) : null}
        <Champ
          libelle={t("Libellé", "Label")}
          required
          maxLength={200}
          value={s.libelle}
          onChange={(e) => maj("libelle", e.target.value)}
          erreur={f.erreurs.libelle}
        />
        {regie ? null : (
          <>
            <Select
              libelle={t("Montant exprimé en", "Amount expressed as")}
              options={[
                {
                  valeur: "pourcentage",
                  libelle: t("Pourcentage du budget signé", "Percentage of the signed budget"),
                },
                {
                  valeur: "montant",
                  libelle: t(
                    `Montant (${libelleDevise(devise)})`,
                    `Amount (${libelleDevise(devise)})`,
                  ),
                },
              ]}
              value={s.mode}
              onChange={(e) =>
                maj("mode", e.target.value === "montant" ? "montant" : "pourcentage")
              }
            />
            <Champ
              libelle={
                s.mode === "pourcentage"
                  ? t("Pourcentage (%)", "Percentage (%)")
                  : t(`Montant (${libelleDevise(devise)})`, `Amount (${libelleDevise(devise)})`)
              }
              aide={
                s.mode === "pourcentage"
                  ? t(
                      "Le montant est calculé par le serveur sur le budget signé.",
                      "The amount is computed by the server on the signed budget.",
                    )
                  : aideMontant(devise, langue)
              }
              required
              inputMode="decimal"
              value={s.valeur}
              onChange={(e) => maj("valeur", e.target.value)}
              erreur={f.erreurs.valeur}
            />
          </>
        )}
        <Champ
          libelle={t("Date prévue", "Planned date")}
          type="date"
          required
          value={s.date_prevue}
          onChange={(e) => maj("date_prevue", e.target.value)}
          erreur={f.erreurs.date_prevue}
        />
        <Select
          libelle={t("Jalon lié", "Linked milestone")}
          options={jalons}
          invite={
            jalons.length
              ? t("Aucun jalon", "No milestone")
              : t(
                  "Aucun jalon défini (onglet Découpage)",
                  "No milestone defined (Work breakdown tab)",
                )
          }
          value={s.jalon_id}
          onChange={(e) => maj("jalon_id", e.target.value)}
        />
        {creation ? null : (
          <Select
            libelle={t("Statut", "Status")}
            options={optionsStatutsEcheance(langue)}
            value={s.statut}
            onChange={(e) => maj("statut", e.target.value)}
            erreur={f.erreurs.statut}
          />
        )}
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer", "Save")}
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}

function Generation({
  missionId,
  mode,
  budget,
  devise,
}: { missionId: string; mode: ModeFacturation } & Contexte) {
  const t = useT();
  const langue = useLangue();
  const [s, setS] = useState<SaisieGeneration>(SAISIE_GENERATION_VIDE);
  const f = useFormulaire<ChampGeneration>();
  const besoin = besoinGeneration(mode);
  const maj = (k: keyof SaisieGeneration) => (v: string) => setS((x) => ({ ...x, [k]: v }));
  const champ = (
    k: keyof SaisieGeneration,
    libelle: string,
    props: Record<string, unknown> = {},
  ) => (
    <Champ
      libelle={libelle}
      required
      value={s[k]}
      onChange={(e) => maj(k)(e.target.value)}
      erreur={f.erreurs[k]}
      {...props}
    />
  );
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerGeneration(mode, s, devise, langue),
      (c) => api.post(`/api/missions/${encodeURIComponent(missionId)}/echeancier/generer`, c),
      {
        succes: t("Échéancier généré.", "Schedule generated."),
        messageSpecifique: (e) => messageEcheancier(e, budget, devise, langue),
      },
    );
  }
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Générer l'échéancier", "Generate the schedule")}
    >
      <p className="mp-sous-formulaire__titre">
        {t("Générer l'échéancier", "Generate the schedule")}
      </p>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Génération impossible", "Generation not possible")}
      />
      {besoin === "aucun" ? (
        <p className="mp-texte-doux">
          {t(
            "Forfait : 30 % à la signature, 70 % à la fin de la mission, calculés sur le budget signé. Ajustez ensuite chaque échéance.",
            "Fixed fee: 30% at signing, 70% at the end of the engagement, computed on the signed budget. Then adjust each due date.",
          )}
        </p>
      ) : null}
      {besoin === "part_variable" ? (
        <div className="mp-grille-champs mp-grille-champs--bas">
          {champ("pv_libelle", t("Libellé de la part variable", "Variable fee label"), {
            maxLength: 200,
          })}
          {champ(
            "pv_montant_maximum",
            t(
              `Montant maximum (${libelleDevise(devise)})`,
              `Maximum amount (${libelleDevise(devise)})`,
            ),
            {
              inputMode: "decimal",
              aide: aideMontant(devise, langue),
            },
          )}
          {champ("pv_atteinte", t("Atteinte prévue (%)", "Expected achievement (%)"), {
            inputMode: "decimal",
          })}
          {champ("pv_date", t("Date de facturation", "Invoicing date"), { type: "date" })}
        </div>
      ) : null}
      {besoin === "abonnement" ? (
        <div className="mp-grille-champs mp-grille-champs--bas">
          {champ("ab_libelle", t("Libellé", "Label"), { maxLength: 200 })}
          {champ(
            "ab_montant",
            t(
              `Montant par période (${libelleDevise(devise)})`,
              `Amount per period (${libelleDevise(devise)})`,
            ),
            {
              inputMode: "decimal",
              aide: aideMontant(devise, langue),
            },
          )}
          {champ("ab_date_debut", t("Première échéance", "First due date"), { type: "date" })}
          {champ("ab_nombre", t("Nombre de périodes", "Number of periods"), {
            inputMode: "numeric",
          })}
          <Select
            libelle={t("Périodicité", "Frequency")}
            options={Object.keys(PERIODICITE_LIBELLES).map((valeur) => ({
              valeur,
              libelle: libellePeriodicite(valeur as keyof typeof PERIODICITE_LIBELLES, langue),
            }))}
            value={s.ab_periodicite}
            onChange={(e) => maj("ab_periodicite")(e.target.value)}
            erreur={f.erreurs.ab_periodicite}
          />
        </div>
      ) : null}
      <div>
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Génération…", "Generating…")}
        >
          {t("Générer l'échéancier", "Generate the schedule")}
        </Bouton>
      </div>
    </form>
  );
}

function Regie({ missionId, budget, devise }: { missionId: string } & Contexte) {
  const t = useT();
  const langue = useLangue();
  const [jusquAu, setJusquAu] = useState("");
  const f = useFormulaire<"jusqu_au">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerRegie(jusquAu, langue),
      (c) =>
        api.post<{ elements: unknown[] }>(
          `/api/missions/${encodeURIComponent(missionId)}/echeancier/regie`,
          c,
        ),
      {
        succes: t(
          "Échéances de régie calculées sur les temps validés.",
          "Time-and-materials due dates computed on approved time.",
        ),
        messageSpecifique: (e) => messageEcheancier(e, budget, devise, langue),
      },
    );
  }
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Régie sur temps validés", "Time and materials on approved time")}
    >
      <p className="mp-sous-formulaire__titre">
        {t("Régie sur les temps validés", "Time and materials on approved time")}
      </p>
      <p className="mp-texte-doux">
        {t(
          "Une échéance par mois, sur les temps validés pas encore facturés (calcul du serveur au taux de la mission).",
          "One due date per month, on approved time not yet invoiced (computed by the server at the engagement rate).",
        )}
      </p>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Calcul impossible", "Calculation not possible")}
      />
      <Champ
        libelle={t("Temps validés jusqu'au", "Approved time up to")}
        aide={t("Vide : jusqu'à aujourd'hui.", "Empty: up to today.")}
        type="date"
        value={jusquAu}
        onChange={(e) => setJusquAu(e.target.value)}
        erreur={f.erreurs.jusqu_au}
      />
      <div>
        <Bouton type="submit" chargement={f.enCours} texteChargement={t("Calcul…", "Calculating…")}>
          {t("Calculer la régie", "Compute time and materials")}
        </Bouton>
      </div>
    </form>
  );
}
