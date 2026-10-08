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
import { api } from "../../../../../lib/api";
import {
  besoinGeneration,
  echeanceModifiable,
  messageEcheancier,
  OPTIONS_STATUTS_ECHEANCE,
  OPTIONS_TYPES_SAISIS,
  PERIODICITE_LIBELLES,
  SAISIE_ECHEANCE_VIDE,
  SAISIE_GENERATION_VIDE,
  saisieDepuisEcheance,
  STATUT_ECHEANCE,
  TYPE_ECHEANCE_LIBELLES,
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
  const [ajout, setAjout] = useState(false);
  const m = (v: number | null) => formaterMontantMineur(v, e.devise);
  const contexte = { budget: e.budget_signe, devise: e.devise, jalons };
  return (
    <Carte titre="Échéancier de facturation">
      <div className="mp-pile">
        <dl className="mp-totaux">
          <div className="mp-totaux__element">
            <dt className="mp-totaux__libelle">Budget signé (honoraires)</dt>
            <dd className="mp-totaux__valeur">{m(e.budget_signe)}</dd>
          </div>
          <div className="mp-totaux__element">
            <dt className="mp-totaux__libelle">Total de l&apos;échéancier</dt>
            <dd className="mp-totaux__valeur">{m(e.total)}</dd>
          </div>
          <div className="mp-totaux__element">
            <dt className="mp-totaux__libelle">Reste à planifier</dt>
            <dd className="mp-totaux__valeur">{m(e.reste_a_planifier)}</dd>
          </div>
        </dl>
        {e.depassement !== null && e.depassement > 0 ? (
          <Alerte tonalite="danger" annonce="aucune" titre="Échéancier au-delà du budget signé">
            <p>{`Dépassement : ${m(e.depassement)}. Faites valider une révision du budget ou réduisez les échéances.`}</p>
          </Alerte>
        ) : null}
        <p className="mp-texte-doux mp-texte-petit">
          Le total des échéances est plafonné par le budget signé : toute échéance qui le
          dépasserait est refusée.
        </p>
        {e.echeances.length === 0 ? (
          <p className="mp-texte-doux">Aucune échéance pour l&apos;instant.</p>
        ) : (
          <ul className="mp-liste-lignes" aria-label="Échéances">
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
              titre="Nouvelle échéance"
              initial={SAISIE_ECHEANCE_VIDE}
              creation
              {...contexte}
              onFin={() => setAjout(false)}
              valider={(s) => validerEcheance(s, e.devise)}
              appel={(c) => api.post(`/api/missions/${encodeURIComponent(missionId)}/echeances`, c)}
            />
          ) : (
            <div>
              <Bouton variante="secondaire" icone="plus" onClick={() => setAjout(true)}>
                Ajouter une échéance
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
  const [edition, setEdition, fermerApresRafraichissement] = useFermetureDifferee<true>(
    `${x.statut}-${x.modifie_le ?? ""}`,
  );
  const f = useFormulaire<never>();
  const [attente, marquer] = useAttenteRafraichissement(`${x.statut}-${x.libelle}-${x.montant}`);
  const chemin = `/api/echeances/${encodeURIComponent(x.id)}`;
  const modifiable = gerer && echeanceModifiable(x);
  const jalon = jalons.find((j) => j.valeur === x.jalon_id)?.libelle;
  const msg = (err: unknown) => messageEcheancier(err, budget, devise);
  const basculer = () =>
    f.envoyer(
      { ok: true, charge: { statut: x.statut === "prevue" ? "a_facturer" : "prevue" } },
      (c) => api.patch(chemin, c),
      { apres: marquer, messageSpecifique: msg },
    );
  return (
    <li className="mp-liste-lignes__ligne">
      <span className="mp-liste-lignes__texte">
        <strong>{x.libelle}</strong>
        <span className="mp-texte-doux">
          {[
            TYPE_ECHEANCE_LIBELLES[x.type],
            `prévue le ${formaterDate(x.date_prevue)}`,
            x.pourcentage !== null ? `${formaterNombre(x.pourcentage, 4)} % du budget` : null,
            x.periode_debut && x.periode_fin
              ? `temps du ${formaterDate(x.periode_debut)} au ${formaterDate(x.periode_fin)}`
              : null,
            jalon ? `jalon : ${jalon}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {x.facture_id ? (
          <Link href={`/facturation/${x.facture_id}`} className="mp-texte-petit">
            Rattachée à une facture en cours
          </Link>
        ) : null}
      </span>
      <span className="mp-montant">{formaterMontantMineur(x.montant, x.devise)}</span>
      <BadgeStatut tonalite={STATUT_ECHEANCE[x.statut].tonalite}>
        {STATUT_ECHEANCE[x.statut].libelle}
      </BadgeStatut>
      {modifiable && !edition ? (
        <div className="mp-barre-actions mp-barre-actions--compacte">
          <Bouton
            variante="secondaire"
            chargement={f.enCours || attente}
            texteChargement="Enregistrement…"
            onClick={basculer}
            aria-label={
              x.statut === "prevue"
                ? `Marquer ${x.libelle} à facturer`
                : `Remettre ${x.libelle} en prévue`
            }
          >
            {x.statut === "prevue" ? "Marquer à facturer" : "Remettre en prévue"}
          </Bouton>
          <Bouton
            variante="discret"
            icone="crayon"
            onClick={() => setEdition(true)}
            aria-label={`Modifier l'échéance ${x.libelle}`}
          >
            Modifier
          </Bouton>
          <BoutonConfirmation
            libelle="Supprimer"
            variante="discret"
            icone="corbeille"
            ariaLabel={`Supprimer l'échéance ${x.libelle}`}
            question={`Supprimer l'échéance « ${x.libelle} » ?`}
            libelleConfirmation="Oui, supprimer"
            texteChargement="Suppression…"
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
        refAlerte={f.refAlerte}
        titreErreur="Action impossible"
      />
      {edition ? (
        <FormulaireEcheance
          titre={`Modifier l'échéance ${x.libelle}`}
          initial={saisieDepuisEcheance(x)}
          creation={false}
          regie={x.type === "regie"}
          budget={budget}
          devise={devise}
          jalons={jalons}
          onFin={() => setEdition(null)}
          onEnregistre={fermerApresRafraichissement}
          valider={(s) => validerModificationEcheance(s, devise, x.type)}
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
  const [s, setS] = useState<SaisieEcheance>(initial);
  const f = useFormulaire<ChampEcheance>();
  const maj = <K extends keyof SaisieEcheance>(k: K, v: SaisieEcheance[K]) =>
    setS((x) => ({ ...x, [k]: v }));
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(valider(s), appel, {
      apres: onEnregistre ?? onFin,
      messageSpecifique: (e) => messageEcheancier(e, budget, devise),
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
      <div className="mp-grille-champs">
        {creation ? (
          <Select
            libelle="Type"
            options={OPTIONS_TYPES_SAISIS}
            required
            value={s.type}
            onChange={(e) => maj("type", e.target.value)}
            erreur={f.erreurs.type}
          />
        ) : null}
        <Champ
          libelle="Libellé"
          required
          maxLength={200}
          value={s.libelle}
          onChange={(e) => maj("libelle", e.target.value)}
          erreur={f.erreurs.libelle}
        />
        {regie ? null : (
          <>
            <Select
              libelle="Montant exprimé en"
              options={[
                { valeur: "pourcentage", libelle: "Pourcentage du budget signé" },
                { valeur: "montant", libelle: `Montant (${devise})` },
              ]}
              value={s.mode}
              onChange={(e) =>
                maj("mode", e.target.value === "montant" ? "montant" : "pourcentage")
              }
            />
            <Champ
              libelle={s.mode === "pourcentage" ? "Pourcentage (%)" : `Montant (${devise})`}
              aide={
                s.mode === "pourcentage"
                  ? "Le montant est calculé par le serveur sur le budget signé."
                  : aideMontant(devise)
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
          libelle="Date prévue"
          type="date"
          required
          value={s.date_prevue}
          onChange={(e) => maj("date_prevue", e.target.value)}
          erreur={f.erreurs.date_prevue}
        />
        <Select
          libelle="Jalon lié"
          options={jalons}
          invite={jalons.length ? "Aucun jalon" : "Aucun jalon défini (onglet Découpage)"}
          value={s.jalon_id}
          onChange={(e) => maj("jalon_id", e.target.value)}
        />
        {creation ? null : (
          <Select
            libelle="Statut"
            options={OPTIONS_STATUTS_ECHEANCE}
            value={s.statut}
            onChange={(e) => maj("statut", e.target.value)}
            erreur={f.erreurs.statut}
          />
        )}
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          Annuler
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
      validerGeneration(mode, s, devise),
      (c) => api.post(`/api/missions/${encodeURIComponent(missionId)}/echeancier/generer`, c),
      {
        succes: "Échéancier généré.",
        messageSpecifique: (e) => messageEcheancier(e, budget, devise),
      },
    );
  }
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Générer l'échéancier"
    >
      <p className="mp-sous-formulaire__titre">Générer l&apos;échéancier</p>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Génération impossible"
      />
      {besoin === "aucun" ? (
        <p className="mp-texte-doux">
          Forfait : 30 % à la signature, 70 % à la fin de la mission, calculés sur le budget signé.
          Ajustez ensuite chaque échéance.
        </p>
      ) : null}
      {besoin === "part_variable" ? (
        <div className="mp-grille-champs">
          {champ("pv_libelle", "Libellé de la part variable", { maxLength: 200 })}
          {champ("pv_montant_maximum", `Montant maximum (${devise})`, {
            inputMode: "decimal",
            aide: aideMontant(devise),
          })}
          {champ("pv_atteinte", "Atteinte prévue (%)", { inputMode: "decimal" })}
          {champ("pv_date", "Date de facturation", { type: "date" })}
        </div>
      ) : null}
      {besoin === "abonnement" ? (
        <div className="mp-grille-champs">
          {champ("ab_libelle", "Libellé", { maxLength: 200 })}
          {champ("ab_montant", `Montant par période (${devise})`, {
            inputMode: "decimal",
            aide: aideMontant(devise),
          })}
          {champ("ab_date_debut", "Première échéance", { type: "date" })}
          {champ("ab_nombre", "Nombre de périodes", { inputMode: "numeric" })}
          <Select
            libelle="Périodicité"
            options={Object.entries(PERIODICITE_LIBELLES).map(([valeur, libelle]) => ({
              valeur,
              libelle,
            }))}
            value={s.ab_periodicite}
            onChange={(e) => maj("ab_periodicite")(e.target.value)}
            erreur={f.erreurs.ab_periodicite}
          />
        </div>
      ) : null}
      <div>
        <Bouton type="submit" chargement={f.enCours} texteChargement="Génération…">
          Générer l&apos;échéancier
        </Bouton>
      </div>
    </form>
  );
}

function Regie({ missionId, budget, devise }: { missionId: string } & Contexte) {
  const [jusquAu, setJusquAu] = useState("");
  const f = useFormulaire<"jusqu_au">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerRegie(jusquAu),
      (c) =>
        api.post<{ elements: unknown[] }>(
          `/api/missions/${encodeURIComponent(missionId)}/echeancier/regie`,
          c,
        ),
      {
        succes: "Échéances de régie calculées sur les temps validés.",
        messageSpecifique: (e) => messageEcheancier(e, budget, devise),
      },
    );
  }
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Régie sur temps validés"
    >
      <p className="mp-sous-formulaire__titre">Régie sur les temps validés</p>
      <p className="mp-texte-doux">
        Une échéance par mois, sur les temps validés pas encore facturés (calcul du serveur au taux
        de la mission).
      </p>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Calcul impossible"
      />
      <Champ
        libelle="Temps validés jusqu'au"
        aide="Vide : jusqu'à aujourd'hui."
        type="date"
        value={jusquAu}
        onChange={(e) => setJusquAu(e.target.value)}
        erreur={f.erreurs.jusqu_au}
      />
      <div>
        <Bouton type="submit" chargement={f.enCours} texteChargement="Calcul…">
          Calculer la régie
        </Bouton>
      </div>
    </form>
  );
}
