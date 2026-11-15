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
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
import { api } from "../../../../lib/api";
import { optionsDevises } from "../../../../lib/cabinet";
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
  const t = useT();
  const langue = useLangue();
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
            <BadgeStatut tonalite="attention">
              {t("Valeur de départ à valider", "Starting value pending approval")}
            </BadgeStatut>
          ) : null}
          {grade.actif ? null : (
            <BadgeStatut tonalite="neutre">{t("Inactif", "Inactive")}</BadgeStatut>
          )}
        </span>
      }
    >
      <div className="mp-pile">
        <dl className="mp-liste-def mp-liste-def--compacte">
          <div>
            <dt>{t("Code", "Code")}</dt>
            <dd>
              <code>{grade.code}</code>
            </dd>
          </div>
          <div>
            <dt>{t("Ordre d'affichage", "Display order")}</dt>
            <dd>{grade.ordre}</dd>
          </div>
          {taux ? (
            <div>
              <dt>{t("Taux de vente standard (par jour)", "Standard selling rate (per day)")}</dt>
              <dd>
                {taux.taux_vente_standard === null
                  ? t("Non défini", "Not set")
                  : formaterMontantMineur(taux.taux_vente_standard, taux.devise, langue)}
              </dd>
            </div>
          ) : null}
        </dl>
        <RetourFormulaire
          erreur={validation.erreurGlobale}
          refAlerte={validation.refAlerte}
          titreErreur={t("Validation impossible", "Approval failed")}
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
                aria-label={t(`Modifier le grade ${grade.libelle}`, `Edit grade ${grade.libelle}`)}
              >
                {t("Modifier", "Edit")}
              </Bouton>
            ) : null}
            {peutGererTaux && taux ? (
              <Bouton
                variante="secondaire"
                onClick={() => setEdition("taux")}
                aria-label={t(
                  `Modifier le taux du grade ${grade.libelle}`,
                  `Edit the rate of grade ${grade.libelle}`,
                )}
              >
                {t("Modifier le taux", "Edit rate")}
              </Bouton>
            ) : null}
            {peutGerer && grade.a_valider ? (
              <Bouton
                variante="secondaire"
                icone="succes"
                chargement={validation.enCours}
                texteChargement={t("Validation…", "Approving…")}
                onClick={() =>
                  validation.envoyer({ ok: true, charge: { a_valider: false } }, (c) =>
                    api.patch(chemin, c),
                  )
                }
                aria-label={t(
                  `Valider le grade ${grade.libelle}`,
                  `Approve grade ${grade.libelle}`,
                )}
              >
                {t("Valider", "Approve")}
              </Bouton>
            ) : null}
          </div>
        )}
      </div>
    </Carte>
  );
}

function FormulaireGrade({ grade, onFin }: { grade: Grade; onFin: () => void }) {
  const t = useT();
  const langue = useLangue();
  const [s, setS] = useState({
    code: grade.code,
    libelle: grade.libelle,
    ordre: String(grade.ordre),
  });
  const [actif, setActif] = useState(grade.actif);
  const f = useFormulaire<ChampGrade>();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const v = validerGrade(s, false, langue);
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
      aria-label={t(`Modifier le grade ${grade.libelle}`, `Edit grade ${grade.libelle}`)}
    >
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Libellé", "Label")}
          name="libelle"
          required
          maxLength={80}
          value={s.libelle}
          onChange={(e) => setS((x) => ({ ...x, libelle: e.target.value }))}
          erreur={f.erreurs.libelle}
        />
        <Champ
          libelle={t("Ordre d'affichage", "Display order")}
          name="ordre"
          required
          inputMode="numeric"
          value={s.ordre}
          onChange={(e) => setS((x) => ({ ...x, ordre: e.target.value }))}
          erreur={f.erreurs.ordre}
          aide={t(
            "Du plus junior (petit nombre) au plus senior.",
            "From the most junior (small number) to the most senior.",
          )}
        />
      </div>
      <CaseACocher
        libelle={t("Grade actif", "Active grade")}
        aide={t(
          "Un grade inactif n'est plus proposé pour les collaborateurs.",
          "An inactive grade is no longer offered for staff members.",
        )}
        checked={actif}
        onChange={(e) => setActif(e.target.checked)}
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
  const t = useT();
  const langue = useLangue();
  const [montant, setMontant] = useState(montantVersSaisie(taux.taux_vente_standard, taux.devise));
  const [devise, setDevise] = useState<string>(taux.devise);
  const f = useFormulaire<"taux" | "devise">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerTauxGrade(montant, devise, langue),
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
      aria-label={t(`Taux de vente du grade ${libelle}`, `Selling rate of grade ${libelle}`)}
    >
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Taux de vente standard par jour", "Standard selling rate per day")}
          name="taux"
          inputMode="decimal"
          value={montant}
          onChange={(e) => setMontant(e.target.value)}
          erreur={f.erreurs.taux}
          aide={`${aideMontant(devise as Devise, langue)} ${t("Laisser vide pour retirer le taux.", "Leave empty to remove the rate.")}`}
          autoComplete="off"
        />
        <Select
          libelle={t("Devise", "Currency")}
          name="devise"
          options={optionsDevises(langue)}
          value={devise}
          onChange={(e) => setDevise(e.target.value)}
          erreur={f.erreurs.devise}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer le taux", "Save rate")}
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}

export function CreationGrade() {
  const t = useT();
  const langue = useLangue();
  const vide = { code: "", libelle: "", ordre: "0" };
  const [s, setS] = useState(vide);
  const f = useFormulaire<ChampGrade>();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerGrade(s, true, langue), (c) => api.post("/api/grades", c), {
      succes: t(`Grade « ${s.libelle.trim()} » créé.`, `Grade "${s.libelle.trim()}" created.`),
      apres: () => setS(vide),
    });
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Création impossible", "Creation failed")}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Code", "Code")}
          name="code"
          required
          maxLength={40}
          autoCapitalize="none"
          spellCheck={false}
          value={s.code}
          onChange={(e) => setS((x) => ({ ...x, code: e.target.value }))}
          erreur={f.erreurs.code}
          aide={t(
            "Identifiant stable : minuscules, chiffres, tiret bas (ex. senior). Non modifiable ensuite.",
            "Stable identifier: lowercase letters, digits, underscores (e.g. senior). Cannot be changed afterwards.",
          )}
        />
        <Champ
          libelle={t("Libellé", "Label")}
          name="libelle"
          required
          maxLength={80}
          value={s.libelle}
          onChange={(e) => setS((x) => ({ ...x, libelle: e.target.value }))}
          erreur={f.erreurs.libelle}
          aide={t("Ex. Consultant senior.", "E.g. Senior consultant.")}
        />
        <Champ
          libelle={t("Ordre d'affichage", "Display order")}
          name="ordre"
          required
          inputMode="numeric"
          value={s.ordre}
          onChange={(e) => setS((x) => ({ ...x, ordre: e.target.value }))}
          erreur={f.erreurs.ordre}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone="plus"
          chargement={f.enCours}
          texteChargement={t("Création…", "Creating…")}
        >
          {t("Créer le grade", "Create grade")}
        </Bouton>
      </div>
    </form>
  );
}
