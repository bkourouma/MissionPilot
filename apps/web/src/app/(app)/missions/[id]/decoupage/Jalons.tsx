"use client";

import { useState, type FormEvent } from "react";
import { BoutonConfirmation } from "../../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
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
  const [ajout, setAjout] = useState(false);
  const base = `/api/missions/${encodeURIComponent(missionId)}/jalons`;
  const nomPhase = (id: string | null) => phases.find((p) => p.valeur === id)?.libelle;
  return (
    <div className="mp-pile">
      {jalons.length === 0 ? (
        <p className="mp-texte-doux">Aucun jalon défini.</p>
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
            titre="Nouveau jalon"
            phases={phases}
            initial={SAISIE_JALON_VIDE}
            onFin={() => setAjout(false)}
            envoyer={(c) => api.post(base, { ...c, ordre: ordreSuivant(jalons) })}
          />
        ) : (
          <div>
            <Bouton variante="secondaire" icone="drapeau" onClick={() => setAjout(true)}>
              Ajouter un jalon
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
  const [edition, setEdition] = useState(false);
  const f = useFormulaire<never>();
  const chemin = `${base}/${encodeURIComponent(jalon.id)}`;
  return (
    <li className="mp-liste-lignes__ligne">
      <span className="mp-liste-lignes__texte">
        <strong>{jalon.libelle}</strong>
        <span className="mp-texte-doux">
          {[
            jalon.date_prevue ? `Prévu le ${formaterDate(jalon.date_prevue)}` : "Date à fixer",
            nomPhase ? `Phase : ${nomPhase}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <BadgeStatut tonalite={jalon.atteint ? "succes" : "neutre"}>
        {jalon.atteint ? "Atteint" : "À venir"}
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
                ? `Marquer le jalon ${jalon.libelle} non atteint`
                : `Marquer le jalon ${jalon.libelle} atteint`
            }
          >
            {jalon.atteint ? "Marquer non atteint" : "Marquer atteint"}
          </Bouton>
          <Bouton
            variante="discret"
            icone="crayon"
            onClick={() => setEdition(true)}
            aria-label={`Modifier le jalon ${jalon.libelle}`}
          >
            Modifier
          </Bouton>
          <BoutonConfirmation
            libelle="Supprimer"
            variante="discret"
            icone="corbeille"
            ariaLabel={`Supprimer le jalon ${jalon.libelle}`}
            question={`Supprimer le jalon « ${jalon.libelle} » ?`}
            libelleConfirmation="Oui, supprimer"
            texteChargement="Suppression…"
            action={() => f.envoyer({ ok: true, charge: null }, () => api.supprimer(chemin))}
          />
        </div>
      ) : null}
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Action impossible"
      />
      {edition ? (
        <FormulaireJalon
          titre={`Modifier le jalon ${jalon.libelle}`}
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
  const [s, setS] = useState<SaisieJalon>(initial);
  const f = useFormulaire<"libelle" | "phase_id" | "date_prevue">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerJalon(s), envoyer, { apres: onFin });
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
        <Champ
          libelle="Libellé"
          required
          maxLength={200}
          value={s.libelle}
          onChange={(e) => setS((x) => ({ ...x, libelle: e.target.value }))}
          erreur={f.erreurs.libelle}
        />
        <Select
          libelle="Phase"
          options={phases}
          invite="Mission entière"
          value={s.phase_id}
          onChange={(e) => setS((x) => ({ ...x, phase_id: e.target.value }))}
          erreur={f.erreurs.phase_id}
        />
        <Champ
          libelle="Date prévue"
          type="date"
          value={s.date_prevue}
          onChange={(e) => setS((x) => ({ ...x, date_prevue: e.target.value }))}
          erreur={f.erreurs.date_prevue}
        />
      </div>
      <CaseACocher
        libelle="Atteint"
        checked={s.atteint}
        onChange={(e) => setS((x) => ({ ...x, atteint: e.target.checked }))}
      />
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
