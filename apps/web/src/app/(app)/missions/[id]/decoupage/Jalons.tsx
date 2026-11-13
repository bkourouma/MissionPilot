"use client";

import { useState, type FormEvent } from "react";
import { BoutonConfirmation } from "../../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { useLangue, useT } from "../../../../../components/i18n/FournisseurLangue";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Bouton } from "../../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../../components/ui/CaseACocher";
import { Champ } from "../../../../../components/ui/Champ";
import { Select, type OptionSelect } from "../../../../../components/ui/Select";
import { api } from "../../../../../lib/api";
import {
  ordreSuivant,
  saisieDepuisJalon,
  SAISIE_JALON_VIDE,
  validerJalon,
  type Jalon,
  type SaisieJalon,
} from "../../../../../lib/decoupage";
import { formaterDate } from "../../../../../lib/format";

export interface JalonsProps {
  missionId: string;
  jalons: Jalon[];
  phases: readonly OptionSelect[];
  modifiable: boolean;
}

/** Jalons de la mission (PLN-01) : date prévue, phase de rattachement, atteint ou non. */
export function Jalons({ missionId, jalons, phases, modifiable }: JalonsProps) {
  const t = useT();
  const [ajout, setAjout] = useState(false);
  const base = `/api/missions/${encodeURIComponent(missionId)}/jalons`;
  const nomPhase = (id: string | null) => phases.find((p) => p.valeur === id)?.libelle;
  return (
    <div className="mp-pile">
      {jalons.length === 0 ? (
        <p className="mp-texte-doux">{t("Aucun jalon défini.", "No milestone defined.")}</p>
      ) : (
        <ul className="mp-liste-lignes">
          {jalons.map((j) => (
            <LigneJalon
              key={j.id}
              jalon={j}
              base={base}
              phases={phases}
              modifiable={modifiable}
              nomPhase={nomPhase(j.phase_id)}
            />
          ))}
        </ul>
      )}
      {modifiable ? (
        ajout ? (
          <FormulaireJalon
            titre={t("Nouveau jalon", "New milestone")}
            phases={phases}
            initial={SAISIE_JALON_VIDE}
            onFin={() => setAjout(false)}
            envoyer={(c) => api.post(base, { ...c, ordre: ordreSuivant(jalons) })}
          />
        ) : (
          <div>
            <Bouton variante="secondaire" icone="drapeau" onClick={() => setAjout(true)}>
              {t("Ajouter un jalon", "Add a milestone")}
            </Bouton>
          </div>
        )
      ) : null}
    </div>
  );
}

function LigneJalon({
  jalon,
  base,
  phases,
  modifiable,
  nomPhase,
}: {
  jalon: Jalon;
  base: string;
  phases: readonly OptionSelect[];
  modifiable: boolean;
  nomPhase: string | undefined;
}) {
  const t = useT();
  const langue = useLangue();
  const [edition, setEdition] = useState(false);
  const f = useFormulaire<never>();
  const chemin = `${base}/${encodeURIComponent(jalon.id)}`;
  return (
    <li className="mp-liste-lignes__ligne">
      <span className="mp-liste-lignes__texte">
        <strong>{jalon.libelle}</strong>
        <span className="mp-texte-doux">
          {[
            jalon.date_prevue
              ? `${t("Prévu le", "Planned for")} ${formaterDate(jalon.date_prevue, "UTC", langue)}`
              : t("Date à fixer", "Date to be set"),
            nomPhase ? `${t("Phase : ", "Phase: ")}${nomPhase}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <BadgeStatut tonalite={jalon.atteint ? "succes" : "neutre"}>
        {jalon.atteint ? t("Atteint", "Reached") : t("À venir", "Upcoming")}
      </BadgeStatut>
      {modifiable && !edition ? (
        <div className="mp-barre-actions mp-barre-actions--compacte">
          <Bouton
            variante="discret"
            icone="succes"
            chargement={f.enCours}
            onClick={() =>
              f.envoyer({ ok: true, charge: { atteint: !jalon.atteint } }, (c) =>
                api.patch(chemin, c),
              )
            }
            aria-label={
              jalon.atteint
                ? t(
                    `Marquer le jalon ${jalon.libelle} non atteint`,
                    `Mark milestone ${jalon.libelle} as not reached`,
                  )
                : t(
                    `Marquer le jalon ${jalon.libelle} atteint`,
                    `Mark milestone ${jalon.libelle} as reached`,
                  )
            }
          >
            {jalon.atteint
              ? t("Marquer non atteint", "Mark as not reached")
              : t("Marquer atteint", "Mark as reached")}
          </Bouton>
          <Bouton
            variante="discret"
            icone="crayon"
            onClick={() => setEdition(true)}
            aria-label={t(`Modifier le jalon ${jalon.libelle}`, `Edit milestone ${jalon.libelle}`)}
          >
            {t("Modifier", "Edit")}
          </Bouton>
          <BoutonConfirmation
            libelle={t("Supprimer", "Delete")}
            variante="discret"
            icone="corbeille"
            ariaLabel={t(
              `Supprimer le jalon ${jalon.libelle}`,
              `Delete milestone ${jalon.libelle}`,
            )}
            question={t(
              `Supprimer le jalon « ${jalon.libelle} » ?`,
              `Delete milestone "${jalon.libelle}"?`,
            )}
            libelleConfirmation={t("Oui, supprimer", "Yes, delete")}
            texteChargement={t("Suppression…", "Deleting…")}
            action={() => f.envoyer({ ok: true, charge: null }, () => api.supprimer(chemin))}
          />
        </div>
      ) : null}
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur={t("Action impossible", "Action not possible")}
      />
      {edition ? (
        <FormulaireJalon
          titre={t(`Modifier le jalon ${jalon.libelle}`, `Edit milestone ${jalon.libelle}`)}
          phases={phases}
          initial={saisieDepuisJalon(jalon)}
          onFin={() => setEdition(false)}
          envoyer={(c) => api.patch(chemin, c)}
        />
      ) : null}
    </li>
  );
}

function FormulaireJalon({
  titre,
  phases,
  initial,
  onFin,
  envoyer,
}: {
  titre: string;
  phases: readonly OptionSelect[];
  initial: SaisieJalon;
  onFin: () => void;
  envoyer: (charge: Record<string, unknown>) => Promise<unknown>;
}) {
  const t = useT();
  const langue = useLangue();
  const [s, setS] = useState<SaisieJalon>(initial);
  const f = useFormulaire<"libelle" | "phase_id" | "date_prevue">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerJalon(s, langue), envoyer, { apres: onFin });
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
        <Champ
          libelle={t("Libellé", "Label")}
          required
          maxLength={200}
          value={s.libelle}
          onChange={(e) => setS((x) => ({ ...x, libelle: e.target.value }))}
          erreur={f.erreurs.libelle}
        />
        <Select
          libelle={t("Phase", "Phase")}
          options={phases}
          invite={t("Mission entière", "Whole engagement")}
          value={s.phase_id}
          onChange={(e) => setS((x) => ({ ...x, phase_id: e.target.value }))}
          erreur={f.erreurs.phase_id}
        />
        <Champ
          libelle={t("Date prévue", "Planned date")}
          type="date"
          value={s.date_prevue}
          onChange={(e) => setS((x) => ({ ...x, date_prevue: e.target.value }))}
          erreur={f.erreurs.date_prevue}
        />
      </div>
      <CaseACocher
        libelle={t("Atteint", "Reached")}
        checked={s.atteint}
        onChange={(e) => setS((x) => ({ ...x, atteint: e.target.checked }))}
      />
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
