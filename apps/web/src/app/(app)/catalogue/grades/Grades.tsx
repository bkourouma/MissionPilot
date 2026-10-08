"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Bouton } from "../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../components/ui/CaseACocher";
import { Carte } from "../../../../components/ui/Carte";
import { Champ } from "../../../../components/ui/Champ";
import { Select } from "../../../../components/ui/Select";
import { api } from "../../../../lib/api";
import { OPTIONS_DEVISES } from "../../../../lib/cabinet";
import {
  validerGrade,
  validerTauxGrade,
  type ChampGrade,
  type Grade,
} from "../../../../lib/collaborateurs";
import { formaterMontantMineur, type Devise } from "../../../../lib/format";
import { aideMontant, montantVersSaisie } from "../../../../lib/saisie";

export interface CarteGradeProps {
  grade: Grade;
  /** Fourni par le serveur seulement si l'utilisateur a finance.lire. */
  taux?: { taux_vente_standard: number | null; devise: Devise };
  peutGerer: boolean;
  peutGererTaux: boolean;
}

export function CarteGrade({ grade, taux, peutGerer, peutGererTaux }: CarteGradeProps) {
  const [edition, setEdition] = useState<"aucune" | "grade" | "taux">("aucune");
  const validation = useFormulaire<never>();
  const chemin = `/api/grades/${encodeURIComponent(grade.id)}`;

  return (
    <Carte
      niveauTitre={3}
      titre={grade.libelle}
      actions={
        <span className="mp-badges">
          {grade.a_valider ? (
            <BadgeStatut tonalite="attention">Valeur de départ à valider</BadgeStatut>
          ) : null}
          {grade.actif ? null : <BadgeStatut tonalite="neutre">Inactif</BadgeStatut>}
        </span>
      }
    >
      <div className="mp-pile">
        <dl className="mp-liste-def mp-liste-def--compacte">
          <div>
            <dt>Code</dt>
            <dd>
              <code>{grade.code}</code>
            </dd>
          </div>
          <div>
            <dt>Ordre d&apos;affichage</dt>
            <dd>{grade.ordre}</dd>
          </div>
          {taux ? (
            <div>
              <dt>Taux de vente standard (par jour)</dt>
              <dd>
                {taux.taux_vente_standard === null
                  ? "Non défini"
                  : formaterMontantMineur(taux.taux_vente_standard, taux.devise)}
              </dd>
            </div>
          ) : null}
        </dl>
        <RetourFormulaire
          erreur={validation.erreurGlobale}
          refAlerte={validation.refAlerte}
          titreErreur="Validation impossible"
        />
        {edition === "grade" ? (
          <FormulaireGrade grade={grade} onFin={() => setEdition("aucune")} />
        ) : edition === "taux" && taux ? (
          <FormulaireTaux
            gradeId={grade.id}
            taux={taux}
            libelle={grade.libelle}
            onFin={() => setEdition("aucune")}
          />
        ) : (
          <div className="mp-barre-actions">
            {peutGerer ? (
              <Bouton
                variante="secondaire"
                icone="crayon"
                onClick={() => setEdition("grade")}
                aria-label={`Modifier le grade ${grade.libelle}`}
              >
                Modifier
              </Bouton>
            ) : null}
            {peutGererTaux && taux ? (
              <Bouton
                variante="secondaire"
                onClick={() => setEdition("taux")}
                aria-label={`Modifier le taux du grade ${grade.libelle}`}
              >
                Modifier le taux
              </Bouton>
            ) : null}
            {peutGerer && grade.a_valider ? (
              <Bouton
                variante="secondaire"
                icone="succes"
                chargement={validation.enCours}
                texteChargement="Validation…"
                onClick={() =>
                  validation.envoyer({ ok: true, charge: { a_valider: false } }, (c) =>
                    api.patch(chemin, c),
                  )
                }
                aria-label={`Valider le grade ${grade.libelle}`}
              >
                Valider
              </Bouton>
            ) : null}
          </div>
        )}
      </div>
    </Carte>
  );
}

function FormulaireGrade({ grade, onFin }: { grade: Grade; onFin: () => void }) {
  const [s, setS] = useState({
    code: grade.code,
    libelle: grade.libelle,
    ordre: String(grade.ordre),
  });
  const [actif, setActif] = useState(grade.actif);
  const f = useFormulaire<ChampGrade>();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const v = validerGrade(s, false);
    await f.envoyer(
      v.ok ? { ok: true, charge: { ...v.charge, actif } } : v,
      (c) => api.patch(`/api/grades/${encodeURIComponent(grade.id)}`, c),
      { apres: onFin },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={`Modifier le grade ${grade.libelle}`}
    >
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle="Libellé"
          name="libelle"
          required
          maxLength={80}
          value={s.libelle}
          onChange={(e) => setS((x) => ({ ...x, libelle: e.target.value }))}
          erreur={f.erreurs.libelle}
        />
        <Champ
          libelle="Ordre d'affichage"
          name="ordre"
          required
          inputMode="numeric"
          value={s.ordre}
          onChange={(e) => setS((x) => ({ ...x, ordre: e.target.value }))}
          erreur={f.erreurs.ordre}
          aide="Du plus junior (petit nombre) au plus senior."
        />
      </div>
      <CaseACocher
        libelle="Grade actif"
        aide="Un grade inactif n'est plus proposé pour les collaborateurs."
        checked={actif}
        onChange={(e) => setActif(e.target.checked)}
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

function FormulaireTaux({
  gradeId,
  taux,
  libelle,
  onFin,
}: {
  gradeId: string;
  taux: { taux_vente_standard: number | null; devise: Devise };
  libelle: string;
  onFin: () => void;
}) {
  const [montant, setMontant] = useState(montantVersSaisie(taux.taux_vente_standard, taux.devise));
  const [devise, setDevise] = useState<string>(taux.devise);
  const f = useFormulaire<"taux" | "devise">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerTauxGrade(montant, devise),
      (c) => api.put(`/api/grades/${encodeURIComponent(gradeId)}/taux`, c),
      { apres: onFin },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={`Taux de vente du grade ${libelle}`}
    >
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle="Taux de vente standard par jour"
          name="taux"
          inputMode="decimal"
          value={montant}
          onChange={(e) => setMontant(e.target.value)}
          erreur={f.erreurs.taux}
          aide={`${aideMontant(devise as Devise)} Laisser vide pour retirer le taux.`}
          autoComplete="off"
        />
        <Select
          libelle="Devise"
          name="devise"
          options={OPTIONS_DEVISES}
          value={devise}
          onChange={(e) => setDevise(e.target.value)}
          erreur={f.erreurs.devise}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer le taux
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}

export function CreationGrade() {
  const vide = { code: "", libelle: "", ordre: "0" };
  const [s, setS] = useState(vide);
  const f = useFormulaire<ChampGrade>();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerGrade(s, true), (c) => api.post("/api/grades", c), {
      succes: `Grade « ${s.libelle.trim()} » créé.`,
      apres: () => setS(vide),
    });
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Création impossible"
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Code"
          name="code"
          required
          maxLength={40}
          autoCapitalize="none"
          spellCheck={false}
          value={s.code}
          onChange={(e) => setS((x) => ({ ...x, code: e.target.value }))}
          erreur={f.erreurs.code}
          aide="Identifiant stable : minuscules, chiffres, tiret bas (ex. senior). Non modifiable ensuite."
        />
        <Champ
          libelle="Libellé"
          name="libelle"
          required
          maxLength={80}
          value={s.libelle}
          onChange={(e) => setS((x) => ({ ...x, libelle: e.target.value }))}
          erreur={f.erreurs.libelle}
          aide="Ex. Consultant senior."
        />
        <Champ
          libelle="Ordre d'affichage"
          name="ordre"
          required
          inputMode="numeric"
          value={s.ordre}
          onChange={(e) => setS((x) => ({ ...x, ordre: e.target.value }))}
          erreur={f.erreurs.ordre}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" icone="plus" chargement={f.enCours} texteChargement="Création…">
          Créer le grade
        </Bouton>
      </div>
    </form>
  );
}
